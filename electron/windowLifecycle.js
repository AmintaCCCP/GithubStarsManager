'use strict';

/**
 * Electron commits the native minimized state before emitting `minimize`.
 * Hide on the next event-loop turn instead of re-entering Windows window-state
 * handling from inside that dispatch.
 *
 * A restore can arrive before the scheduled callback runs, so re-check both
 * the preference and window state before hiding.
 */
function scheduleMinimizeToTray({ win, shouldHide, schedule = setImmediate }) {
  if (!shouldHide()) return;

  schedule(() => {
    if (!shouldHide() || win.isDestroyed() || !win.isMinimized()) return;
    win.hide();
  });
}

module.exports = { scheduleMinimizeToTray };
