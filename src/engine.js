/**
 * Main Automation Engine
 * Orchestrates browser automation with all integrated modules
 */

const { chromium } = require('playwright');
const config = require('./config');
const PromptQueue = require('./queue');
const AuthManager = require('./auth');
const AntiBot = require('./antibot');
const extractor = require('./extractor');
const { StatsTracker } = require('./utils');
const path = require('path');
const fs = require('fs');

class AutomationEngine {
  constructor(options = {}) {
    this.config = config;
    this.targetUrl = options.targetUrl || process.env.TARGET_URL || 'https://example.com/chat';
    this.browser = null;
    this.context = null;
    this.page = null;
    this.isShuttingDown = false;
    
    // Initialize modules
    this.queue = new PromptQueue({
      checkpointFile: path.join(config.paths.outputDir, 'checkpoint.json'),
      maxRetries: config.retryPolicies.maxRetries
    });
    
    this.antibot = new AntiBot({
      delays: config.delays
    });
    
    this.stats = new StatsTracker();
    
    // Auth manager (optional - configure if needed)
    this.auth = null; // Can be initialized with custom login function
  }

  /**
   * Initialize browser and context with anti-detection measures
   */
  async initialize() {
    this.log('info', 'Initializing automation engine...');
    
    // Launch browser
    this.browser = await chromium.launch({
      headless: config.browser.headless,
      devtools: config.browser.devtools,
      slowMo: config.browser.slowMo,
      args: config.browser.args
    });

    // Create context with anti-bot fingerprint
    const contextOptions = this.antibot.buildContextOptions({
      storageState: await fs.promises.access(config.paths.authSessionFile)
        .then(() => config.paths.authSessionFile)
        .catch(() => undefined)
    });

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();

    // Apply stealth patches
    await this.antibot.applyStealth(this.page);

    // Set timeouts
    this.page.setDefaultTimeout(config.timeouts.action);
    this.page.setDefaultNavigationTimeout(config.timeouts.navigation);

    this.log('info', `Navigating to: ${this.targetUrl}`);
    await this.page.goto(this.targetUrl, { waitUntil: 'domcontentloaded' });

    // Check for challenges
    const challenge = await this.antibot.detectChallenge(this.page);
    if (challenge.detected) {
      this.log('warn', `Challenge detected: ${challenge.type} - ${challenge.evidence}`);
      this.log('warn', 'Waiting for manual resolution... (press Ctrl+C to abort)');
      const resolved = await this.antibot.waitForChallengeResolution(this.page, 120000);
      if (!resolved) {
        throw new Error('Failed to resolve challenge');
      }
      this.log('info', 'Challenge resolved successfully');
    }

    // Save initial session
    await this.saveSession();
    this.log('info', 'Engine initialized successfully');
  }

  /**
   * Save browser session state
   */
  async saveSession() {
    if (!this.context) return;
    try {
      await this.context.storageState({ path: config.paths.authSessionFile });
      this.log('debug', 'Session saved');
    } catch (err) {
      this.log('error', `Failed to save session: ${err.message}`);
    }
  }

  /**
   * Submit a single prompt and extract response
   */
  async submitPrompt(task) {
    const startTime = Date.now();
    this.log('info', `Processing task [${task.id}]`);

    try {
      const { promptTextarea, sendButton, lastResponse } = config.selectors.chat;

      // Micro activity to appear more human
      await this.antibot.microActivity(this.page);
      await this.antibot.sleep('step');

      // Wait for and locate textarea
      const textareaLocator = this.page.locator(promptTextarea).first();
      await textareaLocator.waitFor({ state: 'visible', timeout: config.timeouts.elementWait });

      // Count existing responses before submission
      const initialResponseCount = await this.page.locator(lastResponse).count();

      // Type prompt with human-like timing
      await this.antibot.typeHuman(textareaLocator, task.prompt);
      await this.antibot.sleep('action');

      // Click send button
      const sendLocator = this.page.locator(sendButton).first();
      await this.antibot.humanClick(this.page, sendLocator);
      this.log('debug', `Prompt submitted for task [${task.id}]`);

      // Wait for new response to appear
      const newResponseLocator = this.page.locator(lastResponse).nth(initialResponseCount);
      await newResponseLocator.waitFor({ 
        state: 'attached', 
        timeout: config.timeouts.elementWait 
      });

      // Wait for streaming to complete
      await extractor.waitForResponse(
        this.page,
        lastResponse,
        {
          timeout: config.timeouts.streamResponse,
          stabilityDelay: 1500,
          loaderSelectors: [config.selectors.indicators.loadingSpinner, config.selectors.chat.stopButton]
        }
      );

      // Extract response text
      const responseText = await extractor.extractFormattedText(this.page, lastResponse);

      // Extract any images if present
      const images = await extractor.extractImages(this.page, lastResponse);
      const downloadedImages = [];

      if (images.length > 0) {
        this.log('info', `Found ${images.length} images in response`);
        for (let i = 0; i < images.length; i++) {
          try {
            const filename = `${task.id}_image_${i + 1}_${Date.now()}.png`;
            const imagePath = await extractor.downloadImage(
              images[i],
              config.paths.downloadsDir,
              filename,
              ({ percent }) => {
                if (percent % 25 === 0) {
                  this.log('debug', `Downloading image ${i + 1}: ${percent}%`);
                }
              }
            );
            downloadedImages.push(imagePath);
          } catch (err) {
            this.log('warn', `Failed to download image ${i + 1}: ${err.message}`);
          }
        }
      }

      const durationMs = Date.now() - startTime;
      const result = {
        text: responseText,
        images: downloadedImages,
        timestamp: new Date().toISOString(),
        durationMs
      };

      // Save result to file
      const outputPath = path.join(config.paths.outputDir, `${task.id}.json`);
      await fs.promises.writeFile(outputPath, JSON.stringify(result, null, 2));

      this.log('info', `✓ Task [${task.id}] completed in ${durationMs}ms`);
      this.log('debug', `Preview: ${responseText?.slice(0, 100)}...`);

      return result;
    } catch (error) {
      this.log('error', `✗ Task [${task.id}] failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Process queue with retry logic
   */
  async processQueue() {
    this.log('info', `Starting queue processing. Stats: ${JSON.stringify(this.queue.getStats())}`);

    while (this.queue.hasPending() && !this.isShuttingDown) {
      const task = this.queue.getNext();
      if (!task) break;

      try {
        const result = await this.submitPrompt(task);
        this.queue.complete(task.id, result);
        this.stats.record({ success: true, durationMs: result.durationMs });

        // Save session periodically
        await this.saveSession();

        // Human-like pause between tasks
        await this.antibot.humanPause(2000, 5000);
      } catch (error) {
        this.queue.fail(task.id, error);
        this.stats.record({ success: false });

        // Exponential backoff on failure
        const backoffDelay = config.getBackoffDelay(task.attempts - 1);
        this.log('warn', `Waiting ${backoffDelay}ms before retry...`);
        await new Promise(r => setTimeout(r, backoffDelay));
      }
    }

    this.log('info', 'Queue processing completed');
    this.log('info', `Final stats: ${JSON.stringify(this.stats.getMetrics())}`);
    this.log('info', `Queue stats: ${JSON.stringify(this.queue.getStats())}`);
  }

  /**
   * Graceful shutdown
   */
  async shutdown(signal) {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;
    
    this.log('info', `Graceful shutdown initiated (Signal: ${signal || 'MANUAL'})`);

    try {
      await this.saveSession();
      if (this.context) await this.context.close();
      if (this.browser) await this.browser.close();
      this.log('info', 'Engine terminated cleanly');
    } catch (err) {
      this.log('error', `Error during shutdown: ${err.message}`);
    } finally {
      process.exit(0);
    }
  }

  /**
   * Simple logger
   */
  log(level, message, meta = '') {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    console.log(`${prefix} ${message}`, meta);
  }
}

module.exports = AutomationEngine;
