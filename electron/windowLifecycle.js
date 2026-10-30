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
const lastPaintReloads = new WeakMap();
// Avoid beginFrameSubscription here: electron/electron#37412 can crash the GPU
// process when frame capture overlaps window resizing. Two rAF turns still prove
// that the renderer/compositor BeginFrame pipeline resumed after invalidate().
const FRAME_PROBE_SCRIPT = `new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
})`;

/**
 * Windows can resume a visible window without resuming its compositor (#533).
 * Force one repaint, then verify requestAnimationFrame resumes. Reload only
 * when the window is still focused; an occluded window is expected to stop
 * producing frames and must not lose renderer state.
 */
function probeWindowPaint({
  win,
  reason = 'unknown',
  record = () => {},
  timeoutMs = 1500,
  reloadCooldownMs = 60_000,
  now = Date.now,
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
    return true;
  };
  activePaintProbes.add(win);

  const handleFailure = (kind, error) => {
    if (finished) return;
    const stillVisible = !win.isDestroyed() && win.isVisible() && !win.isMinimized();
    const focused = stillVisible && win.isFocused();
    const contentsGone = contents.isDestroyed();
    const loading = !contentsGone && contents.isLoadingMainFrame();
    finish();
    record({
      level: focused ? 'warn' : 'info',
      module: 'electron.window',
      message: kind === 'timeout' ? 'Window paint probe timed out' : 'Window paint probe failed',
      data: {
        reason,
        focused,
        loading,
        ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
      },
    });
    if (kind !== 'timeout' || !focused || loading || contentsGone) return;

    const lastReloadAt = lastPaintReloads.get(win);
    const cooldownRemainingMs = lastReloadAt === undefined
      ? 0
      : reloadCooldownMs - (now() - lastReloadAt);
    if (cooldownRemainingMs > 0) {
      record({
        level: 'info',
        module: 'electron.window',
        message: 'Window reload suppressed by cooldown',
        data: { reason, cooldownRemainingMs },
      });
      return;
    }

    lastPaintReloads.set(win, now());
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
  };

  const timer = schedule(() => handleFailure('timeout'), timeoutMs);

  try {
    contents.invalidate();
    contents.executeJavaScript(FRAME_PROBE_SCRIPT, false).then(
      () => finish(),
      (error) => handleFailure('probe-failed', error),
    );
  } catch (error) {
    handleFailure('probe-failed', error);
  }
}

module.exports = { scheduleMinimizeToTray, probeWindowPaint };
