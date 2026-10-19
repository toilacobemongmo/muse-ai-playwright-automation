/**
 * utils.js - Core Utility Module for Worker Fleet
 * Components: File I/O, Network (Image Download), DOM Validators, Stats Tracker, Cleanup
 */

const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');
const { finished } = require('stream/promises');

// ==========================================
// 1. FILE I/O HELPERS
// ==========================================
const FileIO = {
    async ensureDir(dirPath) {
        await fsPromises.mkdir(dirPath, { recursive: true });
        return dirPath;
    },

    async fileExists(filePath) {
        try {
            await fsPromises.access(filePath, fs.constants.F_OK);
            return true;
        } catch {
            return false;
        }
    },

    async writeJson(filePath, data, spaces = 2) {
        await FileIO.ensureDir(path.dirname(filePath));
        await fsPromises.writeFile(filePath, JSON.stringify(data, null, spaces), 'utf8');
    },

    async readJson(filePath) {
        const content = await fsPromises.readFile(filePath, 'utf8');
        return JSON.parse(content);
    },

    async safeWriteFile(filePath, data) {
        await FileIO.ensureDir(path.dirname(filePath));
        const tempPath = `${filePath}.tmp.${Date.now()}`;
        await fsPromises.writeFile(tempPath, data);
        await fsPromises.rename(tempPath, filePath);
    }
};

// ==========================================
// 2. NETWORK UTILITIES (IMAGE DOWNLOADER)
// ==========================================
const Network = {
    async downloadImage(url, destPath, options = {}) {
        const { timeout = 15000, allowedMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } = options;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
            await FileIO.ensureDir(path.dirname(destPath));
            const response = await fetch(url, { signal: controller.signal });
            
            if (!response.ok) {
                throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
            }

            const contentType = response.headers.get('content-type');
            if (allowedMime.length > 0 && !allowedMime.some(mime => contentType?.includes(mime))) {
                throw new Error(`Invalid content-type: ${contentType}`);
            }

            const fileStream = fs.createWriteStream(destPath, { flags: 'w' });
            await finished(Readable.fromWeb(response.body).pipe(fileStream));
            return { success: true, path: destPath, size: (await fsPromises.stat(destPath)).size };
        } catch (error) {
            if (await FileIO.fileExists(destPath)) {
                await fsPromises.unlink(destPath).catch(() => {});
            }
            throw new Error(`Download failed [${url}]: ${error.message}`);
        } finally {
            clearTimeout(timer);
        }
    }
};

// ==========================================
// 3. DOM SELECTOR VALIDATORS
// ==========================================
const DOMValidator = {
    // Kiểm tra tính hợp lệ cú pháp CSS Selector mà không cần nạp DOM engine
    isValidCssSelector(selector) {
        if (typeof selector !== 'string' || !selector.trim()) return false;
        try {
            // Chuỗi kiểm tra cơ bản tính hợp lệ của cấu trúc selector
            const dummy = selector.trim();
            const invalidTokens = /[<>{}|^~*+=]$|^\s*[,>+~]/;
            if (invalidTokens.test(dummy)) return false;
            
            // Thử kiểm tra bằng standard parsing logic
            return !dummy.includes('::') || /::(before|after|placeholder|first-letter|first-line)/.test(dummy);
        } catch {
            return false;
        }
    },

    isValidXPath(xpath) {
        if (typeof xpath !== 'string' || !xpath.trim()) return false;
        const xpathPattern = /^(\/|\.\/|\.\.\/|\/\/|[a-zA-Z0-9_-]+)/;
        return xpathPattern.test(xpath.trim());
    },

    validateSchema(selectorsMap) {
        const errors = [];
        for (const [key, selector] of Object.entries(selectorsMap)) {
            if (!this.isValidCssSelector(selector) && !this.isValidXPath(selector)) {
                errors.push({ key, selector, error: 'Invalid selector syntax' });
            }
        }
        return {
            valid: errors.length === 0,
            errors
        };
    }
};

// ==========================================
// 4. STATISTICS CALCULATOR
// ==========================================
class StatsTracker {
    constructor() {
        this.reset();
    }

    reset() {
        this.totalTasks = 0;
        this.successTasks = 0;
        this.failedTasks = 0;
        this.tokens = { prompt: 0, completion: 0, total: 0 };
        this.durations = [];
        this.startTime = Date.now();
    }

    record(task) {
        const { success = false, durationMs = 0, promptTokens = 0, completionTokens = 0 } = task;
        
        this.totalTasks += 1;
        if (success) this.successTasks += 1;
        else this.failedTasks += 1;

        this.tokens.prompt += promptTokens;
        this.tokens.completion += completionTokens;
        this.tokens.total += (promptTokens + completionTokens);

        if (typeof durationMs === 'number' && durationMs >= 0) {
            this.durations.push(durationMs);
        }
    }

    getMetrics() {
        const avgTime = this.durations.length 
            ? (this.durations.reduce((a, b) => a + b, 0) / this.durations.length).toFixed(2)
            : 0;

        const successRate = this.totalTasks 
            ? ((this.successTasks / this.totalTasks) * 100).toFixed(2) + '%' 
            : '0.00%';

        return {
            totalTasks: this.totalTasks,
            successRate,
            failedCount: this.failedTasks,
            avgDurationMs: Number(avgTime),
            tokensUsed: { ...this.tokens },
            uptimeSec: Math.floor((Date.now() - this.startTime) / 1000)
        };
    }
}

// ==========================================
// 5. CLEANUP UTILITIES
// ==========================================
const Cleanup = {
    async removeFileSafe(filePath) {
        try {
            await fsPromises.unlink(filePath);
            return true;
        } catch (err) {
            if (err.code === 'ENOENT') return false;
            throw err;
        }
    },

    async cleanTempFiles(dirPath, maxAgeMs = 3600000) {
        if (!(await FileIO.fileExists(dirPath))) return 0;

        const now = Date.now();
        let deletedCount = 0;
        const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            try {
                if (entry.isDirectory()) {
                    deletedCount += await Cleanup.cleanTempFiles(fullPath, maxAgeMs);
                } else {
                    const stats = await fsPromises.stat(fullPath);
                    if (now - stats.mtimeMs > maxAgeMs) {
                        await fsPromises.unlink(fullPath);
                        deletedCount++;
                    }
                }
            } catch {
                // Tiếp tục xử lý file khác nếu 1 file bị lock
            }
        }
        return deletedCount;
    }
};

module.exports = {
    FileIO,
    Network,
    DOMValidator,
    StatsTracker,
    Cleanup
};
