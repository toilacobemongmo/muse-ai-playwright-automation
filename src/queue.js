const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class PromptQueue {
  /**
   * @param {Object} options
   * @param {string} [options.checkpointFile='./data/queue_checkpoint.json'] Đường dẫn file checkpoint
   * @param {number} [options.maxRetries=3] Số lần thử lại tối đa cho mỗi prompt
   */
  constructor(options = {}) {
    this.checkpointFile = path.resolve(options.checkpointFile || './data/queue_checkpoint.json');
    this.maxRetries = options.maxRetries ?? 3;
    this.items = new Map(); // id -> item
  }

  // ==================== 1. FILE LOADERS ====================

  /**
   * Tải prompts từ file (.txt, .json, .csv)
   * @param {string} filePath 
   * @param {Object} [opts] Tùy chọn cho CSV: { column: 'prompt' }
   */
  async loadFromFile(filePath, opts = {}) {
    const ext = path.extname(filePath).toLowerCase();
    const raw = await fs.promises.readFile(filePath, 'utf-8');

    let prompts = [];

    if (ext === '.txt') {
      prompts = raw.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(p => ({ prompt: p }));
    } else if (ext === '.json') {
      const parsed = JSON.parse(raw);
      prompts = Array.isArray(parsed) 
        ? parsed.map(item => (typeof item === 'string' ? { prompt: item } : item))
        : [];
    } else if (ext === '.csv') {
      prompts = this._parseCsv(raw, opts.column || 'prompt');
    } else {
      throw new Error(`Định dạng file không hỗ trợ: ${ext}`);
    }

    this._enqueueBatch(prompts);
    this.saveCheckpoint();
    return this.items.size;
  }

  _parseCsv(content, promptColumn) {
    const lines = content.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return [];

    const headers = this._parseCsvRow(lines[0]).map(h => h.trim());
    const promptIdx = headers.indexOf(promptColumn);

    if (promptIdx === -1) {
      throw new Error(`Không tìm thấy cột "${promptColumn}" trong file CSV.`);
    }

    const results = [];
    for (let i = 1; i < lines.length; i++) {
      const row = this._parseCsvRow(lines[i]);
      if (!row[promptIdx]) continue;
      
      const meta = {};
      headers.forEach((h, idx) => {
        if (idx !== promptIdx && row[idx] !== undefined) meta[h] = row[idx];
      });

      results.push({ prompt: row[promptIdx], metadata: meta });
    }
    return results;
  }

  _parseCsvRow(line) {
    const result = [];
    let insideQuote = false;
    let entry = '';
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (insideQuote && line[i + 1] === '"') {
          entry += '"';
          i++;
        } else {
          insideQuote = !insideQuote;
        }
      } else if (char === ',' && !insideQuote) {
        result.push(entry);
        entry = '';
      } else {
        entry += char;
      }
    }
    result.push(entry);
    return result;
  }

  _enqueueBatch(list) {
    for (const item of list) {
      const id = item.id || crypto.randomUUID();
      if (!this.items.has(id)) {
        this.items.set(id, {
          id,
          prompt: item.prompt,
          metadata: item.metadata || {},
          status: 'pending', // pending | processing | completed | failed
          attempts: 0,
          maxRetries: item.maxRetries ?? this.maxRetries,
          error: null,
          result: null,
          updatedAt: new Date().toISOString()
        });
      }
    }
  }

  // ==================== 2. QUEUE OPERATIONS ====================

  /**
   * Lấy tác vụ tiếp theo sẵn sàng xử lý
   */
  getNext() {
    for (const item of this.items.values()) {
      if (item.status === 'pending') {
        item.status = 'processing';
        item.attempts += 1;
        item.updatedAt = new Date().toISOString();
        this.saveCheckpoint();
        return item;
      }
    }
    return null;
  }

  /**
   * Đánh dấu thành công
   */
  complete(id, result = null) {
    const item = this.items.get(id);
    if (!item) return;

    item.status = 'completed';
    item.result = result;
    item.error = null;
    item.updatedAt = new Date().toISOString();
    this.saveCheckpoint();
  }

  /**
   * Đánh dấu thất bại & kích hoạt Retry logic
   */
  fail(id, error) {
    const item = this.items.get(id);
    if (!item) return;

    item.error = error?.message || String(error);
    item.updatedAt = new Date().toISOString();

    if (item.attempts < item.maxRetries) {
      item.status = 'pending'; // Đưa lại vào hàng đợi để retry
    } else {
      item.status = 'failed';  // Đã hết số lần retry cho phép
    }
    this.saveCheckpoint();
  }

  hasPending() {
    for (const item of this.items.values()) {
      if (item.status === 'pending') return true;
    }
    return false;
  }

  getStats() {
    const stats = { total: 0, pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const item of this.items.values()) {
      stats.total++;
      stats[item.status]++;
    }
    return stats;
  }

  // ==================== 3. CHECKPOINT & RESUME ====================

  /**
   * Lưu state xuống đĩa. Dùng file tạm (.tmp) + rename để chống corrupt dữ liệu nếu crash giữa chừng.
   */
  saveCheckpoint() {
    const tempFile = `${this.checkpointFile}.tmp`;
    const data = JSON.stringify(Array.from(this.items.values()), null, 2);
    try {
      fs.writeFileSync(tempFile, data, 'utf-8');
      fs.renameSync(tempFile, this.checkpointFile);
    } catch (err) {
      console.error('[QueueManager] Checkpoint save error:', err.message);
    }
  }

  /**
   * Nạp lại tiến trình từ checkpoint và phục hồi các task đang chạy dở dang
   */
  resume() {
    if (!fs.existsSync(this.checkpointFile)) {
      return false;
    }

    try {
      const raw = fs.readFileSync(this.checkpointFile, 'utf-8');
      const data = JSON.parse(raw);

      this.items.clear();
      for (const item of data) {
        // Tự động khôi phục: Tác vụ đang chạy dở ('processing') khi bị ngắt được trả về 'pending'
        if (item.status === 'processing') {
          item.status = item.attempts >= item.maxRetries ? 'failed' : 'pending';
        }
        this.items.set(item.id, item);
      }
      return true;
    } catch (err) {
      console.error('[QueueManager] Resume error:', err.message);
      return false;
    }
  }
}

module.exports = PromptQueue;
