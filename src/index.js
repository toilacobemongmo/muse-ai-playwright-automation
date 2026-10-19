#!/usr/bin/env node
/**
 * Entry Point - Muse AI Playwright Automation
 * Usage: node src/index.js [--prompts <file>] [--resume] [--dry-run] [--url <url>]
 */

const path = require('path');
const fs = require('fs');
const config = require('./config');
const AutomationEngine = require('./engine');
const PromptQueue = require('./queue');
const { FileIO } = require('./utils');

// ============================ ARGUMENT PARSING ============================
function parseArgs(argv) {
  const args = { prompts: null, resume: false, dryRun: false, url: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--prompts' || a === '-p') args.prompts = argv[++i];
    else if (a === '--resume' || a === '-r') args.resume = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--url' || a === '-u') args.url = argv[++i];
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
Muse AI Playwright Automation

Usage:
  node src/index.js [options]

Options:
  -p, --prompts <file>   Path to prompts file (.txt, .json, .csv)
  -r, --resume           Resume from last checkpoint
  -u, --url <url>        Override target URL
  --dry-run              Validate config and inputs without launching browser
  -h, --help             Show this help message

Environment variables (see .env.example):
  TARGET_URL, HEADLESS, TIMEOUT_*, MAX_RETRIES, etc.
`);
}

// ============================ HELPERS ============================
async function findDefaultPromptsFile() {
  const candidates = [
    path.join(config.paths.promptsDir, 'prompts.txt'),
    path.join(config.paths.promptsDir, 'tasks.json'),
    path.resolve(process.cwd(), 'prompts.txt'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ============================ MAIN ============================
async function main() {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    return;
  }

  // Ensure data directories exist
  await Promise.all([
    FileIO.ensureDir(config.paths.promptsDir),
    FileIO.ensureDir(config.paths.outputDir),
    FileIO.ensureDir(config.paths.downloadsDir),
    FileIO.ensureDir(config.paths.logsDir),
    FileIO.ensureDir(path.dirname(config.paths.authSessionFile)),
  ]);

  const targetUrl = args.url || process.env.TARGET_URL;
  if (!targetUrl) {
    console.error(
      '[FATAL] No target URL configured. Set TARGET_URL in .env or pass --url <url>.'
    );
    process.exit(1);
  }

  // ----- Prepare queue -----
  const queue = new PromptQueue({
    checkpointFile: path.join(config.paths.outputDir, 'checkpoint.json'),
    maxRetries: config.retryPolicies.maxRetries,
  });

  let loaded = false;
  if (args.resume) {
    loaded = queue.resume();
    if (loaded) {
      console.log(`[INFO] Resumed from checkpoint: ${JSON.stringify(queue.getStats())}`);
    } else {
      console.warn('[WARN] --resume specified but no checkpoint found. Loading prompts instead.');
    }
  }

  if (!loaded) {
    const promptsFile = args.prompts
      ? path.resolve(args.prompts)
      : await findDefaultPromptsFile();

    if (!promptsFile || !fs.existsSync(promptsFile)) {
      console.error(
        '[FATAL] No prompts file found. Provide --prompts <file> or create data/prompts/prompts.txt'
      );
      process.exit(1);
    }

    console.log(`[INFO] Loading prompts from: ${promptsFile}`);
    const count = await queue.loadFromFile(promptsFile);
    console.log(`[INFO] Loaded ${count} prompt(s). Stats: ${JSON.stringify(queue.getStats())}`);
  }

  // ----- Dry run -----
  if (args.dryRun) {
    console.log('[DRY-RUN] Configuration and inputs validated successfully.');
    console.log(`[DRY-RUN] Target URL: ${targetUrl}`);
    console.log(`[DRY-RUN] Headless: ${config.browser.headless}`);
    console.log(`[DRY-RUN] Queue: ${JSON.stringify(queue.getStats())}`);
    console.log('[DRY-RUN] No browser will be launched.');
    return;
  }

  // ----- Execute -----
  const engine = new AutomationEngine({ targetUrl });

  // Wire the shared queue into the engine (single source of truth)
  engine.queue = queue;

  // Signal handlers
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => {
    process.once(sig, () => engine.shutdown(sig));
  });

  process.on('unhandledRejection', (reason) => {
    engine.log('error', `Unhandled rejection: ${reason?.stack || reason}`);
  });
  process.on('uncaughtException', (err) => {
    engine.log('error', `Uncaught exception: ${err.stack || err.message}`);
    engine.shutdown('UNCAUGHT_EXCEPTION');
  });

  try {
    await engine.initialize();
    await engine.processQueue();
    await engine.shutdown('TASK_COMPLETED');
  } catch (error) {
    engine.log('error', `Fatal error: ${error.stack || error.message}`);
    await engine.shutdown('FATAL_ERROR');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[FATAL]', err);
    process.exit(1);
  });
}

module.exports = { main };
