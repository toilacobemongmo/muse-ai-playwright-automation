/**
 * auth.js - Authentication & Session Management Module
 * Worker #3 Implementation - Playwright Session Persistence
 */

const fs = require('fs');
const path = require('path');

class AuthManager {
  /**
   * @param {Object} config
   * @param {string} [config.storagePath='./data/auth/session.json'] - Path to storage state
   * @param {string} config.checkUrl - URL to verify session validity
   * @param {string} [config.loginUrl] - Login page URL (for redirect detection)
   * @param {Function} config.loginFn - async (page) => Promise<void> login implementation
   * @param {Function} [config.validatorFn] - async (page, response) validation function
   */
  constructor({
    storagePath = './data/auth/session.json',
    checkUrl,
    loginUrl,
    loginFn,
    validatorFn = null,
  }) {
    if (!loginFn) throw new Error('[AuthManager] loginFn is required.');
    if (!checkUrl) throw new Error('[AuthManager] checkUrl is required.');

    this.storagePath = path.resolve(storagePath);
    this.checkUrl = checkUrl;
    this.loginUrl = loginUrl;
    this.loginFn = loginFn;
    this.validatorFn = validatorFn;

    // Mutex to prevent concurrent login attempts
    this._reauthPromise = null;
  }

  /**
   * Check if session file exists
   */
  async sessionExists() {
    try {
      await fs.promises.access(this.storagePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save cookies and localStorage from BrowserContext to disk
   */
  async saveSession(context) {
    const dir = path.dirname(this.storagePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await context.storageState({ path: this.storagePath });
  }

  /**
   * Check if cookies are expired offline (without launching browser)
   */
  async areCookiesExpiredOffline() {
    if (!(await this.sessionExists())) return true;
    try {
      const raw = await fs.promises.readFile(this.storagePath, 'utf8');
      const data = JSON.parse(raw);
      const now = Date.now() / 1000;
      
      if (!data.cookies || data.cookies.length === 0) return true;
      
      const sessionCookies = data.cookies.filter(c => c.expires !== -1);
      if (sessionCookies.length > 0 && sessionCookies.every(c => c.expires < now)) {
        return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  /**
   * Initialize BrowserContext with existing session if available
   */
  async initContext(browser, contextOptions = {}) {
    const exists = await this.sessionExists();
    const options = { ...contextOptions };

    if (exists) {
      options.storageState = this.storagePath;
    }

    return await browser.newContext(options);
  }

  /**
   * Validate session by checking HTTP status, redirects, and custom validator
   */
  async isSessionValid(page) {
    try {
      const response = await page.goto(this.checkUrl, { 
        waitUntil: 'domcontentloaded', 
        timeout: 15000 
      });
      if (!response) return false;

      // Check HTTP status
      if ([401, 403].includes(response.status())) return false;

      // Check for redirect to login page
      if (this.loginUrl && page.url().includes(this.loginUrl)) return false;

      // Custom validation if provided
      if (this.validatorFn) {
        return await this.validatorFn(page, response);
      }

      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Perform login and save new session state
   */
  async _performLogin(browser, contextOptions = {}) {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    try {
      await this.loginFn(page);
      await this.saveSession(context);
      return context;
    } catch (error) {
      await context.close();
      throw new Error(`[AuthManager] Authentication failed: ${error.message}`);
    } finally {
      await page.close();
    }
  }

  /**
   * Ensure authenticated context (auto re-auth if session is invalid)
   * Uses mutex to prevent concurrent login attempts
   */
  async ensureAuthenticated(browser, contextOptions = {}) {
    if (this._reauthPromise) {
      await this._reauthPromise;
      return await this.initContext(browser, contextOptions);
    }

    const offlineExpired = await this.areCookiesExpiredOffline();

    if (!offlineExpired) {
      const context = await this.initContext(browser, contextOptions);
      const testPage = await context.newPage();
      const valid = await this.isSessionValid(testPage);
      await testPage.close();

      if (valid) return context;

      // Session invalid, close context and re-authenticate
      await context.close();
    }

    // Trigger re-authentication with single-flight lock
    this._reauthPromise = this._performLogin(browser, contextOptions)
      .finally(() => {
        this._reauthPromise = null;
      });

    return await this._reauthPromise;
  }

  /**
   * Execute task with automatic re-authentication on auth errors
   */
  async executeWithAuth(browser, taskFn, contextOptions = {}) {
    let context = await this.ensureAuthenticated(browser, contextOptions);
    let page = await context.newPage();

    try {
      return await taskFn(page, context);
    } catch (error) {
      const isAuthError =
        error.message?.includes('401') ||
        error.message?.includes('403') ||
        (this.loginUrl && page.url().includes(this.loginUrl));

      if (isAuthError) {
        await context.close();
        // Re-authenticate and retry once
        context = await this._performLogin(browser, contextOptions);
        page = await context.newPage();
        return await taskFn(page, context);
      }
      throw error;
    } finally {
      if (!page.isClosed()) await page.close();
    }
  }
}

module.exports = AuthManager;
