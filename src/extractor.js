/**
 * extractor.js - Result Extraction Module
 * Core Extraction & Pipeline Component
 */

const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

class Extractor {
  /**
   * Chờ element phản hồi kết thúc với cơ chế Smart Stability Timeout
   * @param {object} page - Playwright Page object
   * @param {string} targetSelector - Selector của container phản hồi
   * @param {object} options - Cấu hình timeout & stability check
   */
  async waitForResponse(page, targetSelector, options = {}) {
    const {
      timeout = 60000,
      stabilityDelay = 1500, // Cần không đổi trong N ms để coi là stream xong
      pollInterval = 300,
      loaderSelectors = ['.loading', '.typing', '[aria-busy="true"]', '.streaming-indicator']
    } = options;

    const startTime = Date.now();
    await page.waitForSelector(targetSelector, { timeout });

    let lastContentHash = '';
    let stableSince = Date.now();

    while (Date.now() - startTime < timeout) {
      const state = await page.evaluate(({ selector, loaders }) => {
        const el = document.querySelector(selector);
        if (!el) return { exists: false };

        const hasActiveLoaders = loaders.some(l => !!document.querySelector(l));
        const textContent = el.innerText || '';
        const htmlLength = el.innerHTML.length;
        
        return {
          exists: true,
          hasActiveLoaders,
          hash: `${htmlLength}_${textContent.slice(-50)}`
        };
      }, { selector: targetSelector, loaders: loaderSelectors });

      if (!state.exists) {
        throw new Error(`Target selector "${targetSelector}" disappeared from DOM.`);
      }

      if (!state.hasActiveLoaders) {
        if (state.hash === lastContentHash) {
          if (Date.now() - stableSince >= stabilityDelay) {
            return true; // Stream/render đã hoàn thành và ổn định
          }
        } else {
          lastContentHash = state.hash;
          stableSince = Date.now();
        }
      } else {
        stableSince = Date.now(); // Reset nếu loader xuất hiện lại
      }

      await new Promise(res => setTimeout(res, pollInterval));
    }

    throw new Error(`Smart timeout (${timeout}ms) exceeded while waiting for response stability.`);
  }

  /**
   * Quét và trích xuất URL hình ảnh từ nhiều cấu trúc DOM phức tạp
   * @param {object} page - Playwright Page object
   * @param {string} containerSelector - Selector phạm vi quét
   */
  async extractImages(page, containerSelector = 'body') {
    return await page.evaluate((selector) => {
      const root = document.querySelector(selector) || document.body;
      const images = new Set();

      // 1. Quét thẻ <img> chuẩn và dataset lazy-load
      root.querySelectorAll('img').forEach(img => {
        const src = img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-original');
        if (src && !src.startsWith('data:image/svg+xml') && !src.includes('spacer.gif')) {
          images.add(src);
        }

        // Parse srcset
        const srcset = img.getAttribute('srcset');
        if (srcset) {
          const sources = srcset.split(',').map(s => s.trim().split(' ')[0]);
          sources.forEach(s => s && images.add(s));
        }
      });

      // 2. Quét thẻ <picture> -> <source>
      root.querySelectorAll('picture source').forEach(source => {
        const srcset = source.getAttribute('srcset');
        if (srcset) {
          const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
          urls.forEach(u => u && images.add(u));
        }
      });

      // 3. Quét CSS computed background-image & inline styles
      const allElements = root.querySelectorAll('*');
      for (const el of allElements) {
        const bg = window.getComputedStyle(el).backgroundImage;
        if (bg && bg !== 'none') {
          const match = bg.match(/url\(["']?(https?:\/\/[^"']+|data:image\/[^"']+)["']?\)/i);
          if (match && match[1]) images.add(match[1]);
        }
      }

      // 4. Trích xuất <canvas> export nếu có
      root.querySelectorAll('canvas').forEach(canvas => {
        try {
          images.add(canvas.toDataURL('image/png'));
        } catch {
          // Cross-origin tainted canvas fallback
        }
      });

      return Array.from(images);
    }, containerSelector);
  }

  /**
   * Download ảnh về local storage có Progress Tracking (hỗ trợ HTTP(S) & Data URIs)
   * @param {string} url - Direct URL hoặc Data URI
   * @param {string} outputDir - Thư mục lưu
   * @param {string} filename - Tên file xuất
   * @param {function} onProgress - Callback ({ percent, loaded, total })
   */
  async downloadImage(url, outputDir, filename, onProgress = () => {}) {
    await fs.promises.mkdir(outputDir, { recursive: true });
    const filePath = path.join(outputDir, filename);

    // Xử lý Base64 Data URI
    if (url.startsWith('data:')) {
      const match = url.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (!match) throw new Error('Invalid Base64 Data URI.');
      const buffer = Buffer.from(match[2], 'base64');
      await fs.promises.writeFile(filePath, buffer);
      onProgress({ percent: 100, loaded: buffer.length, total: buffer.length });
      return filePath;
    }

    // Xử lý Remote HTTP/HTTPS
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP Error ${res.status}: ${res.statusText}`);

    const contentLength = res.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    let loaded = 0;

    const bodyReader = res.body.getReader();
    const trackingStream = new Readable({
      async read() {
        const { done, value } = await bodyReader.read();
        if (done) {
          this.push(null);
        } else {
          loaded += value.length;
          const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
          onProgress({ percent, loaded, total });
          this.push(value);
        }
      }
    });

    const fileStream = fs.createWriteStream(filePath);
    await pipeline(trackingStream, fileStream);
    return filePath;
  }

  /**
   * Trích xuất Text giữ nguyên định dạng Markdown (Headers, Code blocks, Lists, Tables)
   * @param {object} page - Playwright Page object
   * @param {string} containerSelector - Selector của container chứa text
   */
  async extractFormattedText(page, containerSelector) {
    return await page.evaluate((selector) => {
      const container = document.querySelector(selector);
      if (!container) return null;

      function walk(node) {
        if (node.nodeType === Node.TEXT_NODE) {
          return node.nodeValue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) {
          return '';
        }

        const tag = node.tagName.toLowerCase();
        let children = Array.from(node.childNodes).map(walk).join('');

        switch (tag) {
          case 'h1': return `\n# ${children.trim()}\n`;
          case 'h2': return `\n## ${children.trim()}\n`;
          case 'h3': return `\n### ${children.trim()}\n`;
          case 'h4': return `\n#### ${children.trim()}\n`;
          case 'h5': return `\n##### ${children.trim()}\n`;
          case 'h6': return `\n###### ${children.trim()}\n`;
          case 'strong':
          case 'b': return `**${children}**`;
          case 'em':
          case 'i': return `*${children}*`;
          case 'code':
            if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') {
              return children;
            }
            return `\`${children}\``;
          case 'pre': {
            const lang = (node.querySelector('code')?.className.match(/language-(\w+)/) || [])[1] || '';
            return `\n\`\`\`${lang}\n${node.textContent.trim()}\n\`\`\`\n`;
          }
          case 'ul': return `\n${children}\n`;
          case 'ol': {
            let idx = 1;
            return `\n${Array.from(node.children).map(li => `${idx++}. ${walk(li).trim()}`).join('\n')}\n`;
          }
          case 'li': {
            if (node.parentElement?.tagName.toLowerCase() === 'ol') return children;
            return `- ${children.trim()}\n`;
          }
          case 'blockquote': return `\n> ${children.trim().replace(/\n/g, '\n> ')}\n`;
          case 'a': {
            const href = node.getAttribute('href');
            return href ? `[${children}](${href})` : children;
          }
          case 'p': return `\n${children.trim()}\n`;
          case 'br': return '\n';
          case 'table': return `\n${children}\n`;
          case 'tr': return `${children}|\n`;
          case 'th':
          case 'td': return `| ${children.trim()} `;
          default:
            return children;
        }
      }

      return walk(container)
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }, containerSelector);
  }
}

module.exports = new Extractor();
