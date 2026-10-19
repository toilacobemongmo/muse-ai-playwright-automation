#!/usr/bin/env node
/**
 * MCP Server - Model Context Protocol Interface
 * Allows AI agents to control the Playwright automation via standardized tools
 * 
 * Usage:
 *   node src/mcp-server.js
 * 
 * MCP Tools Exposed:
 *   - submit_prompt: Submit a single prompt and get response
 *   - submit_batch: Submit multiple prompts from file
 *   - get_status: Get current queue status
 *   - pause_queue: Pause processing
 *   - resume_queue: Resume processing
 *   - get_result: Retrieve result for a task ID
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const AutomationEngine = require('./engine');
const PromptQueue = require('./queue');
const config = require('./config');
const path = require('path');
const fs = require('fs');

class MCPAutomationServer {
  constructor() {
    this.server = new Server(
      {
        name: 'muse-playwright-automation',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.engine = null;
    this.isPaused = false;
    this.setupToolHandlers();
    this.setupErrorHandler();
  }

  setupErrorHandler() {
    this.server.onerror = (error) => {
      console.error('[MCP Server Error]', error);
    };

    process.on('SIGINT', async () => {
      if (this.engine) {
        await this.engine.shutdown('SIGINT');
      }
      await this.server.close();
      process.exit(0);
    });
  }

  setupToolHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'initialize_engine',
          description: 'Initialize the automation engine with browser and target URL',
          inputSchema: {
            type: 'object',
            properties: {
              targetUrl: {
                type: 'string',
                description: 'Target website URL (e.g., https://muse.ai/chat)',
              },
              headless: {
                type: 'boolean',
                description: 'Run browser in headless mode',
                default: false,
              },
            },
            required: ['targetUrl'],
          },
        },
        {
          name: 'submit_prompt',
          description: 'Submit a single prompt and wait for response',
          inputSchema: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: 'The prompt text to submit',
              },
              taskId: {
                type: 'string',
                description: 'Optional task ID (auto-generated if not provided)',
              },
              metadata: {
                type: 'object',
                description: 'Optional metadata for the task',
              },
            },
            required: ['prompt'],
          },
        },
        {
          name: 'submit_batch',
          description: 'Submit multiple prompts from a file',
          inputSchema: {
            type: 'object',
            properties: {
              promptsFile: {
                type: 'string',
                description: 'Path to prompts file (.txt, .json, .csv)',
              },
              resume: {
                type: 'boolean',
                description: 'Resume from checkpoint if exists',
                default: false,
              },
            },
            required: ['promptsFile'],
          },
        },
        {
          name: 'get_status',
          description: 'Get current queue and processing status',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'pause_queue',
          description: 'Pause queue processing',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'resume_queue',
          description: 'Resume queue processing',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'get_result',
          description: 'Retrieve result for a specific task ID',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: {
                type: 'string',
                description: 'Task ID to retrieve result for',
              },
            },
            required: ['taskId'],
          },
        },
        {
          name: 'shutdown_engine',
          description: 'Gracefully shutdown the automation engine',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'initialize_engine':
            return await this.handleInitializeEngine(args);
          case 'submit_prompt':
            return await this.handleSubmitPrompt(args);
          case 'submit_batch':
            return await this.handleSubmitBatch(args);
          case 'get_status':
            return await this.handleGetStatus(args);
          case 'pause_queue':
            return await this.handlePauseQueue(args);
          case 'resume_queue':
            return await this.handleResumeQueue(args);
          case 'get_result':
            return await this.handleGetResult(args);
          case 'shutdown_engine':
            return await this.handleShutdownEngine(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: error.message,
                stack: error.stack,
              }, null, 2),
            },
          ],
          isError: true,
        };
      }
    });
  }

  async handleInitializeEngine(args) {
    if (this.engine) {
      throw new Error('Engine already initialized. Call shutdown_engine first.');
    }

    const { targetUrl, headless = false } = args;

    // Override config if needed
    if (headless !== undefined) {
      config.browser.headless = headless;
    }

    this.engine = new AutomationEngine({ targetUrl });
    await this.engine.initialize();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'success',
            message: 'Engine initialized successfully',
            targetUrl,
            headless: config.browser.headless,
          }, null, 2),
        },
      ],
    };
  }

  async handleSubmitPrompt(args) {
    if (!this.engine) {
      throw new Error('Engine not initialized. Call initialize_engine first.');
    }

    const { prompt, taskId, metadata = {} } = args;
    const id = taskId || `task_${Date.now()}`;

    const task = {
      id,
      prompt,
      metadata,
      attempts: 0,
      status: 'pending',
    };

    this.engine.queue.add(task);
    const result = await this.engine.submitPrompt(task);
    this.engine.queue.complete(id, result);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'success',
            taskId: id,
            result: {
              text: result.text,
              images: result.images,
              durationMs: result.durationMs,
              timestamp: result.timestamp,
            },
          }, null, 2),
        },
      ],
    };
  }

  async handleSubmitBatch(args) {
    if (!this.engine) {
      throw new Error('Engine not initialized. Call initialize_engine first.');
    }

    const { promptsFile, resume = false } = args;
    const filePath = path.resolve(promptsFile);

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    let loaded = false;
    if (resume) {
      loaded = this.engine.queue.resume();
    }

    if (!loaded) {
      const count = await this.engine.queue.loadFromFile(filePath);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              message: `Loaded ${count} prompts from file`,
              queueStats: this.engine.queue.getStats(),
            }, null, 2),
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              status: 'success',
              message: 'Resumed from checkpoint',
              queueStats: this.engine.queue.getStats(),
            }, null, 2),
          },
        ],
      };
    }
  }

  async handleGetStatus(args) {
    if (!this.engine) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              engineInitialized: false,
              message: 'Engine not initialized',
            }, null, 2),
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            engineInitialized: true,
            isPaused: this.isPaused,
            queueStats: this.engine.queue.getStats(),
            engineStats: this.engine.stats.getMetrics(),
          }, null, 2),
        },
      ],
    };
  }

  async handlePauseQueue(args) {
    this.isPaused = true;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'success',
            message: 'Queue paused',
            isPaused: this.isPaused,
          }, null, 2),
        },
      ],
    };
  }

  async handleResumeQueue(args) {
    this.isPaused = false;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'success',
            message: 'Queue resumed',
            isPaused: this.isPaused,
          }, null, 2),
        },
      ],
    };
  }

  async handleGetResult(args) {
    const { taskId } = args;
    const resultPath = path.join(config.paths.outputDir, `${taskId}.json`);

    if (!fs.existsSync(resultPath)) {
      throw new Error(`Result not found for task ID: ${taskId}`);
    }

    const result = JSON.parse(await fs.promises.readFile(resultPath, 'utf8'));

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'success',
            taskId,
            result,
          }, null, 2),
        },
      ],
    };
  }

  async handleShutdownEngine(args) {
    if (!this.engine) {
      throw new Error('Engine not initialized');
    }

    await this.engine.shutdown('MCP_SHUTDOWN');
    this.engine = null;

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            status: 'success',
            message: 'Engine shutdown successfully',
          }, null, 2),
        },
      ],
    };
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[MCP Server] Started successfully');
  }
}

// Start server
if (require.main === module) {
  const server = new MCPAutomationServer();
  server.start().catch((error) => {
    console.error('[FATAL]', error);
    process.exit(1);
  });
}

module.exports = MCPAutomationServer;
