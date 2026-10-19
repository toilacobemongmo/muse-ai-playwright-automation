/**
 * Configuration Manager
 * Loads JSON defaults, resolves paths, applies ENV overrides, and exposes helper utilities.
 */

const fs = require('fs');
const path = require('path');
const rawConfig = require('../config.json');

const ROOT_DIR = path.resolve(__dirname, '..');

// Helper to ensure directories exist
function ensureDirectoryExistence(filePath) {
  const dirname = path.extname(filePath) ? path.dirname(filePath) : filePath;
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
}

// 1. Resolve Absolute Paths
const resolvedPaths = {
  promptsDir: path.resolve(ROOT_DIR, process.env.PROMPTS_DIR || rawConfig.paths.promptsDir),
  outputDir: path.resolve(ROOT_DIR, process.env.OUTPUT_DIR || rawConfig.paths.outputDir),
  downloadsDir: path.resolve(ROOT_DIR, process.env.DOWNLOADS_DIR || rawConfig.paths.downloadsDir),
  authSessionFile: path.resolve(ROOT_DIR, process.env.AUTH_SESSION_FILE || rawConfig.paths.authSessionFile),
  logsDir: path.resolve(ROOT_DIR, process.env.LOGS_DIR || rawConfig.paths.logsDir),
};

// Ensure all target directories exist
Object.values(resolvedPaths).forEach(ensureDirectoryExistence);

// 2. Build Merged Configuration
const config = {
  browser: {
    ...rawConfig.browser,
    headless: process.env.HEADLESS !== undefined 
      ? process.env.HEADLESS === 'true' 
      : rawConfig.browser.headless,
    devtools: process.env.DEVTOOLS !== undefined 
      ? process.env.DEVTOOLS === 'true' 
      : rawConfig.browser.devtools,
    slowMo: process.env.SLOW_MO ? parseInt(process.env.SLOW_MO, 10) : rawConfig.browser.slowMo,
  },

  timeouts: {
    navigation: parseInt(process.env.TIMEOUT_NAV, 10) || rawConfig.timeouts.navigation,
    elementWait: parseInt(process.env.TIMEOUT_WAIT, 10) || rawConfig.timeouts.elementWait,
    action: parseInt(process.env.TIMEOUT_ACTION, 10) || rawConfig.timeouts.action,
    streamResponse: parseInt(process.env.TIMEOUT_STREAM, 10) || rawConfig.timeouts.streamResponse,
  },

  delays: rawConfig.delays,

  paths: resolvedPaths,

  selectors: rawConfig.selectors,

  retryPolicies: {
    ...rawConfig.retryPolicies,
    maxRetries: process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES, 10) : rawConfig.retryPolicies.maxRetries,
  },

  /**
   * Helper: Get random jitter delay within bounds
   * @param {'typing' | 'action' | 'step'} type 
   * @returns {number} Delay in milliseconds
   */
  getRandomDelay(type = 'action') {
    const range = this.delays[type] || this.delays.action;
    return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
  },

  /**
   * Helper: Calculate exponential backoff delay for retries
   * @param {number} attempt Current retry attempt index (starts at 0)
   * @returns {number} Delay in milliseconds
   */
  getBackoffDelay(attempt) {
    const delay = this.retryPolicies.baseDelayMs * Math.pow(this.retryPolicies.backoffFactor, attempt);
    return Math.min(delay, this.retryPolicies.maxDelayMs);
  }
};

module.exports = Object.freeze(config);
