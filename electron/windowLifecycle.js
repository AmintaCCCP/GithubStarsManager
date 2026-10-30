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

const activePaintProbes = new WeakSet();

/**
 * Windows can resume a visible window without resuming its compositor (#533).
 * Force one repaint, then verify a presentation frame actually arrives. Reload
 * only when the window is still focused; an occluded window is expected to
 * stop producing frames and must not lose renderer state.
 */
function probeWindowPaint({
  win,
  reason = 'unknown',
  record = () => {},
  timeoutMs = 1500,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return;
  if (activePaintProbes.has(win)) return;

  const contents = win.webContents;
  if (!contents || contents.isDestroyed()) return;

  let finished = false;
  const finish = () => {
    if (finished) return false;
    finished = true;
    activePaintProbes.delete(win);
    cancel(timer);
    try {
      contents.endFrameSubscription();
    } catch { /* subscription may already be gone */ }
    return true;
  };
  activePaintProbes.add(win);

  const timer = schedule(() => {
    if (finished) return;
    const stillVisible = !win.isDestroyed() && win.isVisible() && !win.isMinimized();
    const focused = stillVisible && win.isFocused();
    const contentsGone = contents.isDestroyed();
    const loading = !contentsGone && contents.isLoadingMainFrame();
    finish();
    record({
      level: focused ? 'warn' : 'info',
      module: 'electron.window',
      message: 'Window paint probe timed out',
      data: { reason, focused, loading },
    });
    if (!focused || loading || contentsGone) return;

    record({
      level: 'warn',
      module: 'electron.window',
      message: 'Reloading window after frozen compositor',
      data: { reason },
    });
    try {
      contents.reload();
    } catch (error) {
      record({
        level: 'error',
        module: 'electron.window',
        message: 'Window reload failed',
        data: { reason, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }, timeoutMs);

  try {
    contents.beginFrameSubscription(false, () => {
      finish();
    });
    contents.invalidate();
  } catch (error) {
    finish();
    record({
      level: 'warn',
      module: 'electron.window',
      message: 'Window paint recovery failed',
      data: { reason, error: error instanceof Error ? error.message : String(error) },
    });
  }
}

module.exports = { scheduleMinimizeToTray, probeWindowPaint };
