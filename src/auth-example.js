/**
 * auth-example.js - Example Login Implementations
 * Demonstrates how to integrate AuthManager with real login flows
 */

const AuthManager = require('./auth');
const config = require('./config');

// ============================================================================
// EXAMPLE 1: Muse AI Login (Email + Password)
// ============================================================================
async function createMuseAuthManager() {
  return new AuthManager({
    storagePath: config.paths.authSessionFile,
    checkUrl: 'https://www.muse.ai/chat', // URL to verify session
    loginUrl: '/login', // Login page path
    
    // Custom login implementation
    loginFn: async (page) => {
      console.log('[Auth] Starting Muse AI login flow...');
      
      // Navigate to login page
      await page.goto('https://www.muse.ai/login', { waitUntil: 'domcontentloaded' });
      
      // Wait for login form
      await page.waitForSelector('input[type="email"]', { timeout: 10000 });
      
      // Get credentials from environment
      const email = process.env.MUSE_EMAIL;
      const password = process.env.MUSE_PASSWORD;
      
      if (!email || !password) {
        throw new Error('MUSE_EMAIL and MUSE_PASSWORD must be set in .env');
      }
      
      // Fill login form
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', password);
      
      // Click login button
      await page.click('button[type="submit"]');
      
      // Wait for navigation to complete
      await page.waitForURL('**/chat', { timeout: 15000 });
      
      // Wait for chat interface to load
      await page.waitForSelector(config.selectors.chat.promptTextarea, { 
        timeout: 10000 
      });
      
      console.log('[Auth] Login successful!');
    },
    
    // Custom session validator (optional)
    validatorFn: async (page, response) => {
      // Check if chat textarea is present (indicates logged in state)
      const textareaVisible = await page.locator(config.selectors.chat.promptTextarea)
        .isVisible()
        .catch(() => false);
      
      return textareaVisible;
    }
  });
}

// ============================================================================
// EXAMPLE 2: OAuth/Social Login (Google, GitHub, etc.)
// ============================================================================
async function createOAuthAuthManager() {
  return new AuthManager({
    storagePath: config.paths.authSessionFile,
    checkUrl: 'https://example.com/dashboard',
    loginUrl: '/auth/login',
    
    loginFn: async (page) => {
      console.log('[Auth] Starting OAuth login flow...');
      
      // Navigate to app login page
      await page.goto('https://example.com/auth/login');
      
      // Click "Sign in with Google" button
      await page.click('button:has-text("Sign in with Google")');
      
      // Wait for Google OAuth popup/redirect
      await page.waitForURL('**/accounts.google.com/**', { timeout: 10000 });
      
      // Fill Google credentials
      await page.fill('input[type="email"]', process.env.GOOGLE_EMAIL);
      await page.click('button:has-text("Next")');
      
      await page.waitForSelector('input[type="password"]', { timeout: 5000 });
      await page.fill('input[type="password"]', process.env.GOOGLE_PASSWORD);
      await page.click('button:has-text("Next")');
      
      // Wait for redirect back to app
      await page.waitForURL('**/example.com/**', { timeout: 15000 });
      
      console.log('[Auth] OAuth login successful!');
    }
  });
}

// ============================================================================
// EXAMPLE 3: Manual Login (for CAPTCHA or 2FA)
// ============================================================================
async function createManualAuthManager() {
  return new AuthManager({
    storagePath: config.paths.authSessionFile,
    checkUrl: 'https://example.com/protected',
    loginUrl: '/login',
    
    loginFn: async (page) => {
      console.log('[Auth] Manual login required...');
      console.log('[Auth] Please complete login manually in the browser window.');
      
      // Navigate to login page
      await page.goto('https://example.com/login');
      
      // Wait for user to manually complete login
      // Detect when URL changes to indicate successful login
      await page.waitForURL('**/dashboard', { timeout: 300000 }); // 5 min timeout
      
      console.log('[Auth] Manual login detected as complete!');
    }
  });
}

// ============================================================================
// EXAMPLE 4: API Token-Based Auth (REST API login)
// ============================================================================
async function createTokenAuthManager() {
  return new AuthManager({
    storagePath: config.paths.authSessionFile,
    checkUrl: 'https://api.example.com/v1/user',
    loginUrl: '/auth/login',
    
    loginFn: async (page) => {
      console.log('[Auth] Token-based login...');
      
      // Get token from API
      const response = await page.request.post('https://api.example.com/auth/login', {
        data: {
          username: process.env.API_USERNAME,
          password: process.env.API_PASSWORD
        }
      });
      
      const data = await response.json();
      const token = data.access_token;
      
      if (!token) {
        throw new Error('Failed to get access token');
      }
      
      // Navigate to app and inject token
      await page.goto('https://example.com');
      
      // Store token in localStorage
      await page.evaluate((token) => {
        localStorage.setItem('auth_token', token);
      }, token);
      
      // Reload to apply token
      await page.reload({ waitUntil: 'domcontentloaded' });
      
      console.log('[Auth] Token injected successfully!');
    },
    
    validatorFn: async (page, response) => {
      // Check if token exists in localStorage
      const token = await page.evaluate(() => localStorage.getItem('auth_token'));
      return !!token;
    }
  });
}

// ============================================================================
// INTEGRATION EXAMPLE: Using AuthManager in Engine
// ============================================================================
async function integrateAuthWithEngine() {
  const { chromium } = require('playwright');
  const authManager = await createMuseAuthManager();
  
  // Launch browser
  const browser = await chromium.launch({ headless: false });
  
  try {
    // Use executeWithAuth for automatic re-authentication
    const result = await authManager.executeWithAuth(
      browser,
      async (page, context) => {
        // Your automation logic here
        await page.goto('https://www.muse.ai/chat');
        
        // ... perform tasks ...
        
        return { success: true };
      },
      {
        // Context options (viewport, userAgent, etc.)
        viewport: { width: 1280, height: 720 }
      }
    );
    
    console.log('Task completed:', result);
  } finally {
    await browser.close();
  }
}

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = {
  createMuseAuthManager,
  createOAuthAuthManager,
  createManualAuthManager,
  createTokenAuthManager,
  integrateAuthWithEngine
};

// ============================================================================
// USAGE INSTRUCTIONS
// ============================================================================
/**
 * To use authentication in your engine:
 * 
 * 1. Add credentials to .env:
 *    MUSE_EMAIL=your-email@example.com
 *    MUSE_PASSWORD=your-password
 * 
 * 2. Modify src/engine.js initialize() method:
 *    const { createMuseAuthManager } = require('./auth-example');
 *    this.auth = await createMuseAuthManager();
 *    
 *    // Replace manual context creation with:
 *    this.context = await this.auth.ensureAuthenticated(this.browser, contextOptions);
 * 
 * 3. Use executeWithAuth for auto re-auth:
 *    await this.auth.executeWithAuth(this.browser, async (page, context) => {
 *      // Your automation tasks
 *    });
 */
