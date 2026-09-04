/**
 * scripts/adapters/http.mjs — Resilient HTTP Fetch Client with Exponential Backoff
 * 
 * Implements:
 * - Up to 5 retries with exponential backoff (1s, 2s, 4s, 8s, 16s + jitter)
 * - Automatic retry on network drops, timeouts, 429 rate limits, and 5xx server errors
 * - Retry-After header awareness for HTTP 429 / 503
 * - Clean timeout signal propagation
 */

export async function fetchWithRetry(url, options = {}, retryConfig = {}) {
  const maxRetries = Number.isInteger(retryConfig.maxRetries) ? retryConfig.maxRetries : 5;
  const initialDelayMs = retryConfig.initialDelayMs || 1000;
  const backoffFactor = retryConfig.backoffFactor || 2;
  const maxDelayMs = retryConfig.maxDelayMs || 16000;
  const timeoutMs = retryConfig.timeoutMs || 20000; // 20s default timeout per attempt

  let lastError = null;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort(new Error("Timeout after " + Math.round(timeoutMs / 1000) + "s"));
      }, timeoutMs);

      // Propagate caller signal if supplied
      if (options.signal) {
        if (options.signal.aborted) {
          clearTimeout(timeoutId);
          throw options.signal.reason || new Error("Request aborted by caller");
        }
        options.signal.addEventListener("abort", () => {
          controller.abort(options.signal.reason);
        }, { once: true });
      }

      const res = await fetch(url, {
        ...options,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Check for transient server errors or rate limiting (429, 500, 502, 503, 504)
      const isTransient = res.status === 429 || (res.status >= 500 && res.status <= 504);
      if (isTransient && attempt < maxRetries) {
        let waitMs = delay;
        const retryAfter = res.headers.get("retry-after");
        if (retryAfter) {
          const parsed = Number(retryAfter);
          if (!isNaN(parsed) && parsed > 0) {
            waitMs = Math.min(parsed * 1000, maxDelayMs);
          }
        }
        const jitter = Math.floor(Math.random() * 250);
        await new Promise(r => setTimeout(r, waitMs + jitter));
        delay = Math.min(delay * backoffFactor, maxDelayMs);
        continue;
      }

      return res;
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries) {
        throw err;
      }
      // Transient connection failure or timeout — back off exponentially
      const jitter = Math.floor(Math.random() * 250);
      await new Promise(r => setTimeout(r, delay + jitter));
      delay = Math.min(delay * backoffFactor, maxDelayMs);
    }
  }

  throw lastError || new Error("Failed to fetch " + url + " after " + maxRetries + " attempts");
}
