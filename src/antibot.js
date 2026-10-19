/**
 * antibot.js - Anti-Detection Module
 * Provides human-like timing, fingerprint randomization, and bot-challenge detection.
 *
 * Designed to reduce (not eliminate) the chance of automated traffic being flagged.
 * Always respect the target site's Terms of Service and robots.txt.
 */

// Realistic desktop viewport pool
const VIEWPORT_POOL = [
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
];

// Realistic desktop user agents (Chrome/Edge/Firefox on Windows/Mac)
const USER_AGENT_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
];

// Common bot-challenge fingerprints
const CHALLENGE_INDICATORS = [
  'iframe[src*="challenges.cloudflare.com"]',
  'div.cf-turnstile',
  '#challenge-form',
  'form[action*="challenge"]',
  'iframe[src*="recaptcha"]',
  'div.g-recaptcha',
  'iframe[src*="hcaptcha.com"]',
];

const CHALLENGE_TEXT_PATTERNS = [
  /verify you are human/i,
  /checking your browser/i,
  /are you a robot/i,
  /attention required/i,
  /just a moment\.\.\./i,
  /enable javascript and cookies to continue/i,
];

class AntiBot {
  constructor(options = {}) {
    this.delays = options.delays || {
      typing: { min: 40, max: 120 },
      action: { min: 500, max: 1500 },
      step: { min: 1000, max: 2500 },
    };
    this.userAgents = options.userAgents || USER_AGENT_POOL;
    this.viewports = options.viewports || VIEWPORT_POOL;
  }

  // ============================ TIMING ============================

  /** Random integer between min and max (inclusive). */
  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /** Get a random delay of the given category in milliseconds. */
  getDelay(type = 'action') {
    const range = this.delays[type] || this.delays.action;
    return this.randomInt(range.min, range.max);
  }

  /** Sleep for a randomized duration. */
  async sleep(type = 'action') {
    const ms = this.getDelay(type);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return ms;
  }

  /** Human-like "thinking" pause with slight gaussian-ish distribution. */
  async humanPause(minMs = 1000, maxMs = 3000) {
    const base = this.randomInt(minMs, maxMs);
    // occasionally longer, like a distracted human
    const jitter = Math.random() < 0.15 ? this.randomInt(500, 2000) : 0;
    await new Promise((resolve) => setTimeout(resolve, base + jitter));
    return base + jitter;
  }

  // ============================ FINGERPRINT ============================

  /** Return a randomized but internally-consistent browser context options object. */
  buildContextOptions(overrides = {}) {
    const viewport = this.viewports[this.randomInt(0, this.viewports.length - 1)];
    const userAgent = this.userAgents[this.randomInt(0, this.userAgents.length - 1)];

    return {
      viewport,
      userAgent,
      screen: viewport,
      locale: 'en-US',
      timezoneId: 'Asia/Saigon',
      colorScheme: 'light',
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
      javaScriptEnabled: true,
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
      },
      ...overrides,
    };
  }

  /**
   * Apply stealth patches to a page (must be called before navigation).
   * Removes the most common automation fingerprints:
   *  - navigator.webdriver
   *  - missing plugins / languages
   *  - chrome runtime
   *  - permissions query quirk
   */
  async applyStealth(page) {
    await page.addInitScript(() => {
      // 1. navigator.webdriver -> undefined
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });

      // 2. Languages
      Object.defineProperty(Navigator.prototype, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true,
      });

      // 3. Plugins (headless has zero, real browsers have several)
      if (navigator.plugins && navigator.plugins.length === 0) {
        Object.defineProperty(Navigator.prototype, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
          configurable: true,
        });
      }

      // 4. Chrome runtime shim
      if (!window.chrome) {
        window.chrome = { runtime: {} };
      }

      // 5. Permissions.query consistency
      const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
      if (originalQuery) {
        window.navigator.permissions.query = (parameters) =>
          parameters.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : originalQuery(parameters);
      }

      // 6. Hardware concurrency sanity
      Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
        get: () => 8,
        configurable: true,
      });

      // 7. WebGL vendor/renderer spoofing
      try {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (parameter) {
          if (parameter === 37445) return 'Intel Inc.';
          if (parameter === 37446) return 'Intel Iris OpenGL Engine';
          return getParameter.apply(this, [parameter]);
        };
      } catch (_) {
        /* WebGL not available */
      }
    });
  }

  // ============================ HUMAN INPUT ============================

  /**
   * Type text with human-like per-character timing.
   * @param {import('playwright').Locator} locator
   * @param {string} text
   */
  async typeHuman(locator, text) {
    const range = this.delays.typing;
    await locator.click();
    for (const char of text) {
      await locator.type(char, { delay: 0 });
      // Variable per-keystroke delay
      let delay = this.randomInt(range.min, range.max);
      // Longer pause on spaces / punctuation, like humans
      if (/[\s.,;:!?]/.test(char)) delay += this.randomInt(30, 120);
      await new Promise((r) => setTimeout(r, delay));
      // Occasional "rethink" pause
      if (Math.random() < 0.02) await this.humanPause(300, 900);
    }
  }

  /**
   * Move mouse in a curve toward the target before clicking.
   * @param {import('playwright').Page} page
   * @param {import('playwright').Locator} locator
   */
  async humanClick(page, locator) {
    const box = await locator.boundingBox();
    if (box) {
      const targetX = box.x + box.width / 2 + this.randomInt(-4, 4);
      const targetY = box.y + box.height / 2 + this.randomInt(-4, 4);
      const startX = this.randomInt(0, Math.max(1, Math.floor(page.viewportSize()?.width || 1280)));
      const startY = this.randomInt(0, Math.max(1, Math.floor(page.viewportSize()?.height || 800)));

      const steps = this.randomInt(8, 18);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        // ease-out curve
        const ease = 1 - Math.pow(1 - t, 2);
        const x = startX + (targetX - startX) * ease;
        const y = startY + (targetY - startY) * ease;
        await page.mouse.move(x, y);
        await new Promise((r) => setTimeout(r, this.randomInt(4, 18)));
      }
    }
    await locator.click();
  }

  /** Simulate small scroll / focus events so the page sees activity. */
  async microActivity(page) {
    try {
      await page.mouse.move(
        this.randomInt(50, 600),
        this.randomInt(50, 400),
        { steps: this.randomInt(3, 8) }
      );
      if (Math.random() < 0.5) {
        await page.evaluate(() => window.scrollBy(0, Math.floor(Math.random() * 120)));
      }
    } catch {
      /* non-critical */
    }
  }

  // ============================ CHALLENGE DETECTION ============================

  /**
   * Detect whether the current page is showing a bot challenge (Cloudflare, reCAPTCHA, hCaptcha).
   * @param {import('playwright').Page} page
   * @returns {Promise<{detected:boolean, type:string|null, evidence:string|null}>}
   */
  async detectChallenge(page) {
    // 1. DOM selector scan
    for (const selector of CHALLENGE_INDICATORS) {
      try {
        const count = await page.locator(selector).count();
        if (count > 0) {
          return {
            detected: true,
            type: this._classifySelector(selector),
            evidence: `selector: ${selector}`,
          };
        }
      } catch {
        /* ignore invalid selector */
      }
    }

    // 2. Page text scan
    try {
      const bodyText = await page.evaluate(() => document.body?.innerText || '');
      for (const pattern of CHALLENGE_TEXT_PATTERNS) {
        if (pattern.test(bodyText)) {
          return { detected: true, type: 'text-challenge', evidence: pattern.source };
        }
      }
    } catch {
      /* ignore */
    }

    // 3. Title scan
    try {
      const title = await page.title();
      if (/just a moment|attention required|access denied/i.test(title)) {
        return { detected: true, type: 'title-challenge', evidence: title };
      }
    } catch {
      /* ignore */
    }

    return { detected: false, type: null, evidence: null };
  }

  _classifySelector(selector) {
    if (selector.includes('turnstile') || selector.includes('challenges.cloudflare')) return 'cloudflare-turnstile';
    if (selector.includes('recaptcha')) return 'recaptcha';
    if (selector.includes('hcaptcha')) return 'hcaptcha';
    return 'unknown-challenge';
  }

  /**
   * Attempt manual/human-in-the-loop resolution.
   * Waits until the challenge disappears or timeout.
   * @param {import('playwright').Page} page
   * @param {number} timeoutMs
   */
  async waitForChallengeResolution(page, timeoutMs = 120000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { detected } = await this.detectChallenge(page);
      if (!detected) return true;
      await new Promise((r) => setTimeout(r, 2000));
    }
    return false;
  }

  /**
   * Placeholder hook for automated solving services (2Captcha, AntiCaptcha).
   * Intentionally not implemented: requires an API key and contract with the provider.
   * @returns {Promise<{solved:boolean, reason:string}>}
   */
  async solveAutomatically(/* page, sitekey */) {
    return {
      solved: false,
      reason: 'No captcha provider configured. Set a provider adapter in antibot.solveAutomatically().',
    };
  }
}

module.exports = AntiBot;
