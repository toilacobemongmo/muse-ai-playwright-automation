# Playwright Automation Agent - Muse AI Web Scraping

Production-ready, enterprise-grade automation framework for web scraping, browser orchestration, and LLM interaction workflows using Playwright. Built to handle large-scale operations with advanced anti-detection, session management, and fault tolerance.

## 🎯 Core Features

- **Browser Automation**: Headless/headed Chrome/Chromium automation
- **Session Persistence**: Cookie and localStorage management with automatic recovery
- **Prompt Queue Processing**: Load and process prompts from TXT, JSON, or CSV files
- **Smart DOM Interaction**: Intelligent element detection and interaction
- **Result Extraction**: Extract text (Markdown-formatted) and download images
- **Anti-Detection**: Human-like delays, fingerprint randomization, stealth plugins
- **Cloudflare/Captcha Support**: Integration-ready with 2Captcha and similar services
- **Fault Tolerance**: Automatic retries, checkpoint system, graceful recovery
- **Performance Tracking**: Built-in metrics, logging, and statistics

## 📋 Prerequisites

- **Node.js**: v18.0.0 or higher
- **npm** or **pnpm**
- **Operating System**: Windows 11, macOS, or Linux

## 🚀 Quick Start

### 1. Installation

```bash
# Clone the repository or navigate to project directory
cd muse_ai_chat_loc

# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium
```

### 2. Configuration

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```ini
NODE_ENV=development
TARGET_URL=https://your-muse-ai-url.com/chat
HEADLESS=false
AUTH_SESSION_FILE=./data/auth/session.json
DOWNLOAD_DIR=./data/downloads
LOG_DIR=./data/logs
TIMEOUT_NAV=45000
TIMEOUT_STREAM=120000
MAX_RETRIES=3
```

### 3. Configure Selectors

Edit [`config.json`](config.json:1) to match your target website's DOM structure:

```json
{
  "selectors": {
    "chat": {
      "promptTextarea": "textarea[placeholder*='message']",
      "sendButton": "button[type='submit']",
      "lastResponse": "div[data-message-author-role='assistant']:last-child"
    }
  }
}
```

### 4. Prepare Prompts

Add your prompts to one of the input files:

**Option A: Simple text file** ([`data/prompts/prompts.txt`](data/prompts/prompts.txt:1))
```text
Your first prompt here
Your second prompt here
```

**Option B: Structured JSON** ([`data/prompts/tasks.json`](data/prompts/tasks.json:1))
```json
[
  {
    "id": "task-001",
    "prompt": "Explain quantum computing in simple terms",
    "metadata": { "category": "education" }
  }
]
```

### 5. Run the Automation

```bash
# Start the engine
npm start

# Or run in development mode with detailed logging
npm run dev
```

## 📁 Project Structure

```text
muse_ai_chat_loc/
├── config.json              # Main configuration (selectors, timeouts, delays)
├── package.json             # Dependencies and scripts
├── .env                     # Environment variables (create from .env.example)
├── .gitignore              # Git exclusions
│
├── src/
│   ├── index.js            # Entry point and CLI handler
│   ├── config.js           # Configuration loader with env overrides
│   ├── engine.js           # Core automation orchestrator
│   ├── auth.js             # Session management and authentication
│   ├── queue.js            # Prompt queue manager with checkpoints
│   ├── extractor.js        # Result extraction (text/images)
│   ├── antibot.js          # Anti-detection and stealth mechanisms
│   └── utils.js            # File I/O, network, validators, stats
│
└── data/
    ├── auth/               # Session storage (cookies, tokens)
    ├── downloads/          # Downloaded images and files
    ├── logs/               # Application logs
    ├── outputs/            # Extracted text responses
    └── prompts/            # Input prompt files
        ├── prompts.txt
        └── tasks.json
```

## 🔧 Configuration Guide

### Environment Variables (.env)

| Variable | Description | Default |
|----------|-------------|---------|
| `TARGET_URL` | Target website URL | Required |
| `HEADLESS` | Run browser in headless mode | `true` |
| `AUTH_SESSION_FILE` | Session persistence file path | `./data/auth/session.json` |
| `DOWNLOAD_DIR` | Directory for downloads | `./data/downloads` |
| `LOG_DIR` | Directory for logs | `./data/logs` |
| `TIMEOUT_NAV` | Navigation timeout (ms) | `45000` |
| `TIMEOUT_STREAM` | LLM response timeout (ms) | `120000` |
| `MAX_RETRIES` | Max retries per task | `3` |
| `TWOCAPTCHA_API_KEY` | 2Captcha API key (optional) | - |

### Selectors Configuration (config.json)

Critical: Update selectors to match your target website's DOM:

```json
{
  "selectors": {
    "auth": {
      "usernameInput": "input[type='email']",
      "passwordInput": "input[type='password']",
      "submitButton": "button[type='submit']",
      "sessionCheck": ".user-avatar"
    },
    "chat": {
      "promptTextarea": "textarea#prompt-textarea",
      "sendButton": "button[data-testid='send-button']",
      "stopButton": "button[aria-label='Stop generating']",
      "lastResponse": "div.agent-turn:last-child"
    },
    "indicators": {
      "loadingSpinner": "[aria-busy='true']",
      "errorMessage": "div[role='alert']"
    }
  }
}
```

## 💡 Usage Examples

### Basic Prompt Processing

```bash
# Process prompts from text file
npm start
```

### Custom Input File

```javascript
// Edit src/index.js to change input file
const queue = new PromptQueue({
  checkpointFile: './data/checkpoint.json',
  maxRetries: 3
});

await queue.loadFromFile('./data/prompts/custom_prompts.csv', {
  column: 'prompt'  // For CSV files
});
```

### Manual Authentication Setup

If you need to log in manually first:

1. Run with `HEADLESS=false` in `.env`
2. The browser will open - log in manually
3. Session will be saved automatically to `AUTH_SESSION_FILE`
4. Next runs will reuse the saved session

## 🛡️ Anti-Detection Features

The framework includes multiple layers of anti-bot detection:

1. **Randomized Delays** ([`src/antibot.js`](src/antibot.js:1))
   - Human-like typing speed
   - Random pauses between actions
   - Configurable delay ranges

2. **Browser Fingerprinting** ([`src/engine.js`](src/engine.js:1))
   - Custom user agents
   - Viewport randomization
   - WebGL/Canvas fingerprint spoofing

3. **Stealth Plugins**
   - Playwright stealth mode
   - Automation flag removal
   - WebDriver detection bypass

4. **Captcha Handling** ([`src/antibot.js`](src/antibot.js:1))
   - 2Captcha integration ready
   - Manual captcha pause mode
   - Automatic retry on captcha detection

## 🔄 Checkpoint & Recovery

The queue system automatically saves progress:

- **Checkpoint File**: `./data/checkpoint.json`
- **Auto-save**: After each task completion
- **Resume**: Automatically continues from last checkpoint
- **Atomic Writes**: Prevents corruption on crash

```javascript
// Queue automatically resumes from checkpoint
const queue = new PromptQueue({
  checkpointFile: './data/checkpoint.json'
});

if (queue.resume()) {
  console.log('Resumed from previous session');
} else {
  await queue.loadFromFile('./data/prompts/prompts.txt');
}
```

## 📊 Statistics & Monitoring

Built-in performance tracking ([`src/utils.js`](src/utils.js:1)):

```javascript
const stats = new StatsTracker();

// Track task execution
stats.record({
  success: true,
  durationMs: 1250,
  promptTokens: 120,
  completionTokens: 450
});

// Get metrics
const metrics = stats.getMetrics();
console.log(metrics);
// Output:
// {
//   totalTasks: 100,
//   successRate: '98.00%',
//   failedCount: 2,
//   avgDurationMs: 1187.45,
//   tokensUsed: { prompt: 12000, completion: 45000, total: 57000 },
//   uptimeSec: 3600
// }
```

## 🐛 Troubleshooting

### Common Issues

**1. Session expired errors**
```bash
# Delete old session and re-authenticate
rm -rf data/auth/session.json
npm start
```

**2. Selector not found errors**
- Verify selectors in [`config.json`](config.json:1) match target website
- Use browser DevTools to inspect elements
- Update selectors accordingly

**3. Timeout errors**
- Increase timeouts in `.env`:
  ```ini
  TIMEOUT_NAV=60000
  TIMEOUT_STREAM=180000
  ```

**4. Captcha blocking**
- Enable 2Captcha: Set `TWOCAPTCHA_API_KEY` in `.env`
- Or run with `HEADLESS=false` to solve manually

**5. Rate limiting**
- Increase delays in [`config.json`](config.json:1):
  ```json
  "delays": {
    "action": { "min": 2000, "max": 5000 },
    "step": { "min": 3000, "max": 8000 }
  }
  ```

## 🔐 Security Best Practices

1. **Never commit `.env` or session files** (already in `.gitignore`)
2. **Rotate credentials regularly**
3. **Use environment variables for sensitive data**
4. **Enable rate limiting** to avoid account bans
5. **Monitor for unusual patterns** that might trigger detection

## 🚀 Advanced Usage

### Custom Extraction Logic

```javascript
// In your custom script
const extractor = require('./src/extractor');

// Wait for response with custom timeout
await extractor.waitForResponse(page, '.result-container', {
  timeout: 90000,
  stabilityDelay: 2000
});

// Extract formatted text
const text = await extractor.extractFormattedText(page, '.markdown-content');

// Extract and download images
const images = await extractor.extractImages(page, '.image-gallery');
for (const url of images) {
  await extractor.downloadImage(url, './downloads', `img_${Date.now()}.png`);
}
```

### Parallel Processing (Future Enhancement)

The architecture supports parallel workers through the swarm system. See Worker #9 Python implementation for distributed processing patterns.

## 📝 License

MIT License - See LICENSE file for details

## 🤝 Contributing

Contributions welcome! Key areas for improvement:
- Additional captcha service integrations
- More anti-detection techniques
- Performance optimizations
- Additional extraction formats

## ⚠️ Disclaimer

This tool is for educational and legitimate automation purposes only. Users are responsible for:
- Complying with target website's Terms of Service
- Respecting robots.txt and rate limits
- Following applicable laws and regulations
- Obtaining necessary permissions

Use responsibly and ethically.

## 📚 Additional Resources

- [Playwright Documentation](https://playwright.dev/)
- [Anti-bot Detection Techniques](https://playwright.dev/docs/browser-contexts)
- [2Captcha API Documentation](https://2captcha.com/2captcha-api)

## 💬 Support

For issues and questions:
1. Check troubleshooting section above
2. Review configuration files
3. Enable debug logging: Set `LOG_LEVEL=debug` in `.env`
4. Check logs in `data/logs/` directory

---

**Built with ❤️ using Playwright and Node.js**
