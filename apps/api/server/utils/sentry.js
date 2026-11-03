import * as Sentry from '@sentry/node';

// Error reporting is opt-in: nothing leaves this server unless SENTRY_DSN is set (and
// SENTRY_ENABLED is not "false").
const dsn = process.env.SENTRY_DSN;
const isSentryEnabled = Boolean(dsn) && process.env.SENTRY_ENABLED !== 'false';

if (isSentryEnabled) {
  Sentry.init({
    dsn,
    integrations: [],
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    profilesSampleRate: 0,
  });
}

/**
 * Wrapper for Sentry.captureException that respects the enabled flag
 * @param {Error | unknown} error - The error to capture
 * @param {import('@sentry/core').CaptureContext} [captureContext] - Optional context for the error
 * @returns {string | undefined}
 */
export function captureException(error, captureContext) {
  if (!isSentryEnabled) {
    // Optionally log to console when Sentry is disabled
    console.debug('[Sentry Disabled] Would have captured:', error);
    return undefined;
  }
  return Sentry.captureException(error, captureContext);
}

/**
 * Wrapper for Sentry.captureMessage that respects the enabled flag
 * @param {string} message - The message to capture
 * @param {import('@sentry/core').CaptureContext | import('@sentry/core').SeverityLevel} [captureContext] - Optional context for the message
 * @returns {string | undefined}
 */
export function captureMessage(message, captureContext) {
  if (!isSentryEnabled) {
    console.debug('[Sentry Disabled] Would have captured message:', message);
    return undefined;
  }
  return Sentry.captureMessage(message, captureContext);
}

// Export original Sentry for any advanced usage
export { Sentry };

// Log initialization status
console.log(`[Sentry] Initialized - Enabled: ${isSentryEnabled} (NODE_ENV: ${process.env.NODE_ENV}, SENTRY_ENABLED: ${process.env.SENTRY_ENABLED})`);
