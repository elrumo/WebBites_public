/**
 * ClaudeRequestQueue - Manages API requests to Claude with rate limiting
 *
 * This queue prevents rate limit errors by:
 * 1. Spreading requests evenly over time
 * 2. Tracking rate limit state from API responses
 * 3. Automatically waiting when limits are approached
 * 4. Handling 429 errors with exponential backoff
 */

export class ClaudeRequestQueue {
  constructor(options = {}) {
    // Configuration
    this.requestsPerMinute = options.requestsPerMinute || 50;
    this.maxConcurrent = options.maxConcurrent || 5; // Max concurrent requests
    this.retryAttempts = options.retryAttempts || 3;

    // State
    this.queue = [];
    this.processing = false;
    this.activeRequests = 0;
    this.interval = 60000 / this.requestsPerMinute; // ms between requests

    // Rate limit tracking from API headers
    this.rateLimitState = {
      inputTokensRemaining: 100000,
      inputTokensLimit: 100000,
      resetTime: null,
      lastUpdated: null
    };

    // Statistics
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      retriedRequests: 0,
      totalWaitTime: 0
    };
  }

  /**
   * Add a request to the queue
   * @param {Function} requestFn - Async function that returns a promise
   * @param {Object} options - Optional metadata for the request
   * @returns {Promise} - Resolves with the request result
   */
  async enqueue(requestFn, options = {}) {
    return new Promise((resolve, reject) => {
      const request = {
        fn: requestFn,
        resolve,
        reject,
        options,
        addedAt: Date.now(),
        attempts: 0,
        id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };

      this.queue.push(request);
      this.stats.totalRequests++;

      // Start processing if not already running
      if (!this.processing) {
        this.process();
      }
    });
  }

  /**
   * Main processing loop
   */
  async process() {
    if (this.processing && this.activeRequests >= this.maxConcurrent) {
      return; // Already at max concurrent requests
    }

    this.processing = true;

    while (this.queue.length > 0 || this.activeRequests > 0) {
      // Wait if we're at max concurrent requests
      if (this.activeRequests >= this.maxConcurrent) {
        await this.sleep(100); // Check every 100ms
        continue;
      }

      // Check if we need to wait for rate limits
      await this.checkRateLimits();

      // Get next request from queue
      const request = this.queue.shift();
      if (!request) {
        // No more queued requests, but wait for active ones to complete
        if (this.activeRequests > 0) {
          await this.sleep(100);
          continue;
        } else {
          break; // Queue is empty and no active requests
        }
      }

      // Process request (don't await - allow concurrent processing)
      this.processRequest(request);

      // Wait before allowing next request to start
      await this.sleep(this.interval);
    }

    this.processing = false;
  }

  /**
   * Process a single request with retry logic
   */
  async processRequest(request) {
    this.activeRequests++;

    try {
      request.attempts++;

      const startTime = Date.now();
      const result = await request.fn();
      const duration = Date.now() - startTime;

      // Update rate limit state from response if available
      if (result?.headers) {
        this.updateRateLimitState(result.headers);
      }

      this.stats.successfulRequests++;
      this.stats.totalWaitTime += Date.now() - request.addedAt;

      request.resolve(result);

    } catch (error) {
      await this.handleRequestError(request, error);
    } finally {
      this.activeRequests--;
    }
  }

  /**
   * Handle request errors with retry logic
   */
  async handleRequestError(request, error) {
    const isRateLimitError = error.status === 429 ||
                            error.statusCode === 429 ||
                            /429|rate limit/i.test(error.message || '');

    // Extract rate limit info from error if available
    if (error.headers) {
      this.updateRateLimitState(error.headers);
    }

    // Determine if we should retry
    const shouldRetry = request.attempts < this.retryAttempts &&
                       (isRateLimitError || this.isRetryableError(error));

    if (shouldRetry) {
      this.stats.retriedRequests++;

      // Calculate backoff delay
      const backoffDelay = this.calculateBackoffDelay(request.attempts, error);

      console.log(`[ClaudeQueue] Retrying request ${request.id} ` +
                 `(attempt ${request.attempts + 1}/${this.retryAttempts}) ` +
                 `after ${backoffDelay}ms`);

      // Wait and re-queue the request
      await this.sleep(backoffDelay);
      this.queue.unshift(request); // Add to front of queue for priority

    } else {
      // Max retries reached or non-retryable error
      this.stats.failedRequests++;
      console.error(`[ClaudeQueue] Request ${request.id} failed after ${request.attempts} attempts:`,
                   error.message);
      request.reject(error);
    }
  }

  /**
   * Check if we need to wait before making next request
   */
  async checkRateLimits() {
    const now = Date.now();

    // If we're low on tokens and have a reset time, wait
    const tokenThreshold = this.rateLimitState.inputTokensLimit * 0.1; // 10% threshold

    if (this.rateLimitState.inputTokensRemaining < tokenThreshold &&
        this.rateLimitState.resetTime) {

      const resetTime = new Date(this.rateLimitState.resetTime).getTime();
      const waitTime = resetTime - now;

      if (waitTime > 0 && waitTime < 120000) { // Only wait if less than 2 minutes
        console.log(`[ClaudeQueue] Proactively waiting ${waitTime}ms for rate limit reset ` +
                   `(${this.rateLimitState.inputTokensRemaining}/${this.rateLimitState.inputTokensLimit} tokens remaining)`);
        await this.sleep(waitTime);

        // Reset our state after waiting
        this.rateLimitState.inputTokensRemaining = this.rateLimitState.inputTokensLimit;
      }
    }
  }

  /**
   * Update rate limit state from API response headers
   */
  updateRateLimitState(headers) {
    if (!headers) return;

    // Extract Anthropic rate limit headers
    const inputRemaining = headers['anthropic-ratelimit-input-tokens-remaining'];
    const inputLimit = headers['anthropic-ratelimit-input-tokens-limit'];
    const resetTime = headers['anthropic-ratelimit-input-tokens-reset'];

    if (inputRemaining !== undefined) {
      this.rateLimitState.inputTokensRemaining = parseInt(inputRemaining);
    }
    if (inputLimit !== undefined) {
      this.rateLimitState.inputTokensLimit = parseInt(inputLimit);
    }
    if (resetTime) {
      this.rateLimitState.resetTime = resetTime;
    }

    this.rateLimitState.lastUpdated = Date.now();
  }

  /**
   * Calculate exponential backoff delay
   */
  calculateBackoffDelay(attempts, error) {
    // If error has a Retry-After header, use that
    if (error.headers?.['retry-after']) {
      return parseInt(error.headers['retry-after']) * 1000;
    }

    // If we have a reset time from headers, calculate wait time
    if (error.headers?.['anthropic-ratelimit-input-tokens-reset']) {
      const resetTime = new Date(error.headers['anthropic-ratelimit-input-tokens-reset']).getTime();
      const waitTime = resetTime - Date.now();
      if (waitTime > 0 && waitTime < 120000) { // Max 2 minutes
        return waitTime;
      }
    }

    // Exponential backoff: 1s, 2s, 4s, 8s...
    return Math.min(1000 * Math.pow(2, attempts - 1), 30000); // Max 30 seconds
  }

  /**
   * Check if error is retryable
   */
  isRetryableError(error) {
    // Network errors
    if (error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.code === 'ENOTFOUND') {
      return true;
    }

    // Timeout errors
    if (error.name === 'AbortError' ||
        /timeout/i.test(error.message || '')) {
      return true;
    }

    // Server errors (5xx)
    if (error.status >= 500 && error.status < 600) {
      return true;
    }

    return false;
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      activeRequests: this.activeRequests,
      rateLimitState: { ...this.rateLimitState },
      averageWaitTime: this.stats.successfulRequests > 0
        ? this.stats.totalWaitTime / this.stats.successfulRequests
        : 0
    };
  }

  /**
   * Clear the queue (useful for testing or emergency stops)
   */
  clear() {
    const clearedCount = this.queue.length;
    this.queue.forEach(request => {
      request.reject(new Error('Queue cleared'));
    });
    this.queue = [];
    console.log(`[ClaudeQueue] Cleared ${clearedCount} pending requests`);
  }
}

// Export singleton instance
export const claudeQueue = new ClaudeRequestQueue({
  requestsPerMinute: 20,  // Conservative rate to avoid acceleration limits
  maxConcurrent: 5,       // Allow some concurrency
  retryAttempts: 3        // Retry up to 3 times
});
