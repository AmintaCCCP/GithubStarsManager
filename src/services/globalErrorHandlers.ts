/**
 * Global error handlers — complements ErrorBoundary (which only covers the
 * React tree) by catching errors that escape every try/catch:
 *   - window 'error' (script errors and resource-load failures, capture phase)
 *   - 'unhandledrejection'
 * Entries are recorded through the existing logger, so they reach the UI ring
 * buffer, the diagnostics panel, and the main-process journal via the
 * diagnostics bridge.
 */

import { logger } from './logger';
import { sanitizeError } from '../utils/logSanitizer';

let installed = false;

/**
 * Install global handlers (idempotent). Resources errors (img/script/link)
 * arrive as non-ErrorEvent 'error' events during the capture phase.
 */
export function installGlobalErrorHandlers(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    try {
      // Resource-load failures (img/script/link) dispatch a plain Event whose
      // target is the element; script errors carry a message and no target.
      const errEvent = event as ErrorEvent;
      const target = (event as Event).target as { tagName?: string; src?: string; href?: string } | null;
      if (typeof errEvent.message === 'string' && errEvent.message && !target?.tagName) {
        // sanitizeError keeps the full stack AND inline-redacts it (Bearer /
        // token / email shapes embedded mid-line that the generic sanitizer's
        // whole-value string rules cannot see), capping it like other errors.
        const { stack } = sanitizeError(errEvent.error);
        logger.error('ui.global', 'Uncaught script error', {
          message: errEvent.message,
          source: errEvent.filename || undefined,
          line: errEvent.lineno || undefined,
          column: errEvent.colno || undefined,
          ...(stack ? { stack } : {}),
        });
        return;
      }
      if (target && typeof target.tagName === 'string') {
        logger.error('ui.global', `Resource failed to load: ${target.tagName.toLowerCase()}`, {
          tag: target.tagName.toLowerCase(),
          url: target.src || target.href || undefined,
        });
      }
    } catch { /* handler must never throw */ }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    try {
      logger.errorFromError('ui.global', 'Unhandled promise rejection', event.reason);
    } catch { /* handler must never throw */ }
  });
}
