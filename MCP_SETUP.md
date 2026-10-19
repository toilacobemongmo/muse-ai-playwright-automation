# MCP Server Setup Guide

## Overview

This MCP (Model Context Protocol) server allows AI agents to control the Playwright automation system programmatically.

## Architecture

```
AI Agent (Claude/GPT) 
    ↓ (MCP Protocol)
MCP Server (src/mcp-server.js)
    ↓ (Internal API)
Automation Engine (src/engine.js)
    ↓ (Playwright)
Browser → Muse AI Website
```

## Installation

### 1. Install Dependencies

```bash
npm install @modelcontextprotocol/sdk
```

### 2. Configure MCP Client

Add to your AI client's MCP configuration file (e.g., `~/.config/claude/mcp.json` or `.roo/mcp.json`):

```json
{
  "mcpServers": {
    "muse-automation": {
      "command": "node",
      "args": ["c:/Users/ghaob/muse_ai_chat_loc/src/mcp-server.js"],
      "env": {
        "TARGET_URL": "https://muse.ai/chat",
        "HEADLESS": "true"
      }
    }
  }
}
```

### 3. Test MCP Server

```bash
# Terminal 1: Start MCP server
node src/mcp-server.js

# Terminal 2: Test with MCP inspector
npx @modelcontextprotocol/inspector node src/mcp-server.js
```

## Available Tools

### 1. `muse_automation_submit_prompt`

Submit a single prompt and get response.

**Parameters:**
- `prompt` (string, required): The text prompt to submit
- `taskId` (string, optional): Custom task ID for tracking

**Example:**
```json
{
  "prompt": "Create a realistic portrait of a cyberpunk character",
  "taskId": "custom_001"
}
```

**Returns:**
```json
{
  "taskId": "custom_001",
  "text": "Here is your generated image...",
  "images": ["c:/Users/ghaob/muse_ai_chat_loc/data/downloads/custom_001_image_1.png"],
  "timestamp": "2026-10-19T04:50:00.000Z",
  "durationMs": 15234
}
```

### 2. `muse_automation_submit_batch`

Submit multiple prompts from a file.

**Parameters:**
- `promptsFile` (string, required): Path to prompts file (.txt, .json, .csv)
- `resume` (boolean, optional): Resume from checkpoint (default: false)

**Example:**
```json
{
  "promptsFile": "data/prompts/batch_001.txt",
  "resume": false
}
```

**Returns:**
```json
{
  "totalTasks": 50,
  "completed": 50,
  "failed": 0,
  "pending": 0,
  "results": [
    {
      "taskId": "task_001",
      "status": "completed",
      "outputFile": "c:/Users/ghaob/muse_ai_chat_loc/data/outputs/task_001.json"
    }
  ]
}
```

### 3. `muse_automation_get_status`

Get current automation status and statistics.

**Parameters:** None

**Returns:**
```json
{
  "engine": {
    "initialized": true,
    "shuttingDown": false,
    "targetUrl": "https://muse.ai/chat"
  },
  "queue": {
    "pending": 0,
    "completed": 45,
    "failed": 2,
    "total": 47
  },
  "stats": {
    "totalRequests": 47,
    "successRate": 95.74,
    "avgDurationMs": 12450,
    "lastError": null
  }
}
```

### 4. `muse_automation_stop`

Gracefully stop the automation engine.

**Parameters:** None

**Returns:**
```json
{
  "message": "Engine shutdown initiated",
  "finalStats": { /* ... */ }
}
```

## Usage Examples

### Example 1: AI-Controlled Image Generation

**AI Prompt:**
```
Use the MCP tool to generate 3 images:
1. A futuristic city at sunset
2. A mystical forest with glowing mushrooms  
3. An underwater temple ruins
```

**AI Actions:**
```javascript
// AI will automatically call:
await muse_automation_submit_prompt({
  prompt: "A futuristic city at sunset, cyberpunk style, neon lights",
  taskId: "city_001"
});

await muse_automation_submit_prompt({
  prompt: "A mystical forest with bioluminescent glowing mushrooms, fantasy art",
  taskId: "forest_001"
});

await muse_automation_submit_prompt({
  prompt: "Ancient underwater temple ruins, rays of light, atlantis style",
  taskId: "temple_001"
});
```

### Example 2: Batch Processing with Monitoring

**AI Prompt:**
```
Process all prompts in data/prompts/campaign_alpha.txt and monitor progress
```

**AI Actions:**
```javascript
// Start batch
await muse_automation_submit_batch({
  promptsFile: "data/prompts/campaign_alpha.txt",
  resume: false
});

// Monitor every 30 seconds
setInterval(async () => {
  const status = await muse_automation_get_status();
  console.log(`Progress: ${status.queue.completed}/${status.queue.total}`);
}, 30000);
```

### Example 3: Resume Failed Jobs

**AI Prompt:**
```
Check if there are any failed tasks and retry them
```

**AI Actions:**
```javascript
const status = await muse_automation_get_status();

if (status.queue.failed > 0) {
  console.log(`Found ${status.queue.failed} failed tasks. Resuming...`);
  await muse_automation_submit_batch({
    promptsFile: "data/prompts/original_batch.txt",
    resume: true  // Will only retry failed tasks
  });
}
```

## Authentication Setup

The automation requires initial manual login. Follow these steps:

### Method 1: Manual Login (First Time)

1. Run with headful browser:
```bash
HEADLESS=false node src/index.js
```

2. Browser will open → manually log in to Muse AI
3. Session will be saved to `data/auth/session.json`
4. Subsequent runs will use saved session automatically

### Method 2: Pre-configured Auth (Advanced)

Use [`src/auth-example.js`](src/auth-example.js:1) as template:

```javascript
const AuthManager = require('./auth');
const { chromium } = require('playwright');

const auth = new AuthManager({
  storagePath: './data/auth/session.json',
  checkUrl: 'https://muse.ai/chat',
  loginUrl: 'https://muse.ai/login',
  loginFn: async (page) => {
    // Implement your login logic
    await page.fill('#email', process.env.MUSE_EMAIL);
    await page.fill('#password', process.env.MUSE_PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/chat', { timeout: 30000 });
  }
});

// Use in engine
const browser = await chromium.launch();
const context = await auth.ensureAuthenticated(browser);
```

## Monitoring & Debugging

### View Real-time Logs

```bash
# Terminal 1: Run automation
node src/index.js --prompts data/prompts/tasks.txt

# Terminal 2: Watch logs
tail -f data/logs/automation.log
```

### Check Results

```bash
# View completed task output
cat data/outputs/task_001.json

# List all downloaded images
ls -lh data/downloads/
```

### MCP Server Logs

MCP server logs are written to `stderr` by default:

```bash
# Redirect to file
node src/mcp-server.js 2> mcp-server.log
```

## Troubleshooting

### Issue: "MCP server not responding"

**Solution:**
1. Check if server is running: `ps aux | grep mcp-server`
2. Test manually: `node src/mcp-server.js`
3. Check MCP client logs for connection errors

### Issue: "Session expired" errors

**Solution:**
1. Delete old session: `rm data/auth/session.json`
2. Run manual login again with `HEADLESS=false`

### Issue: "Cloudflare challenge detected"

**Solution:**
1. Server will pause and wait for manual resolution
2. Solve the challenge in the browser window
3. Automation will resume automatically

### Issue: AI not seeing MCP tools

**Solution:**
1. Verify MCP config file path and syntax
2. Restart AI client after config changes
3. Check MCP server is executable: `node src/mcp-server.js --test`

## Rate Limiting Recommendations

For image generation on Muse AI:

```javascript
// config.json - Recommended settings
{
  "delays": {
    "typingSpeed": [50, 120],     // Human-like typing
    "actionDelay": [800, 1500],   // After actions
    "stepDelay": [1500, 3000],    // Between steps
    "requestInterval": [45000, 60000]  // 45-60s = 1-1.3 req/min
  }
}
```

**Conservative rate:** 1 request/minute (60s intervals)
**Moderate rate:** 1.5 requests/minute (40s intervals)
**Aggressive rate:** 2 requests/minute (30s intervals) - may trigger detection

## Security Considerations

1. **Credentials**: Never commit `data/auth/session.json` or `.env` files
2. **MCP Access**: MCP server has full control over browser - only expose to trusted AI agents
3. **Rate Limits**: Respect service TOS to avoid account suspension
4. **Monitoring**: Log all MCP commands for audit trail

## Next Steps

1. ✅ Install MCP SDK: `npm install @modelcontextprotocol/sdk`
2. ✅ Configure MCP client with [`mcp-config.json`](mcp-config.json:1)
3. ✅ Perform initial login: `HEADLESS=false node src/index.js`
4. ✅ Test MCP tools from AI client
5. ✅ Monitor first batch run for errors

## References

- [MCP Protocol Specification](https://modelcontextprotocol.io)
- [Playwright Documentation](https://playwright.dev)
- Main automation: [`src/engine.js`](src/engine.js:1)
- Auth manager: [`src/auth.js`](src/auth.js:1)
- MCP server: [`src/mcp-server.js`](src/mcp-server.js:1)
