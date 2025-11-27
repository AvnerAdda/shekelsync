/**
 * Simple promise-based mutex for serializing async operations
 * Ensures only one operation runs at a time by queuing subsequent calls
 */
class Mutex {
  constructor() {
    this.queue = [];
    this.locked = false;
  }

  /**
   * Acquire the lock and execute the function
   * @param {Function} fn - Async function to execute with exclusive access
   * @returns {Promise} Result of the function
   */
  async runExclusive(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.locked || this.queue.length === 0) {
      return;
    }

    this.locked = true;
    const { fn, resolve, reject } = this.queue.shift();

    try {
      const result = await fn();
      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.locked = false;
      // Process next item in queue
      this.process();
    }
  }

  /**
   * Check if the mutex is currently locked
   * @returns {boolean}
   */
  isLocked() {
    return this.locked;
  }

  /**
   * Get the number of pending operations in the queue
   * @returns {number}
   */
  getQueueLength() {
    return this.queue.length;
  }
}

module.exports = Mutex;
module.exports.default = Mutex;
