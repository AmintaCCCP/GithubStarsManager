'use strict';

const { performance } = require('node:perf_hooks');

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

const paintProbeStates = new WeakMap();
const lastPaintReloads = new WeakMap();
const BUSY_RENDERER_CPU_PERCENT = 20;
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
  timeoutMs = 5000,
  reloadCooldownMs = 60_000,
  now = () => performance.now(),
  getRendererCpuPercent = () => null,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return;

  const contents = win.webContents;
  if (!contents || contents.isDestroyed()) return;

  const existing = paintProbeStates.get(win);
  if (existing) {
    try {
      contents.invalidate();
    } catch { /* reuse of an existing probe is best-effort */ }
    existing.arm?.();
    return;
  }

  const state = { closed: false, timerDone: false, arm: null };
  paintProbeStates.set(win, state);
  let timer;

  const release = () => {
    if (paintProbeStates.get(win) === state) paintProbeStates.delete(win);
  };
  const close = () => {
    if (state.closed) return false;
    state.closed = true;
    if (!state.timerDone) {
      state.timerDone = true;
      cancel(timer);
    }
    release();
    return true;
  };
  const sampleCpuPercent = () => {
    try {
      const value = getRendererCpuPercent(contents);
      return Number.isFinite(value) ? value : null;
    } catch {
      return null;
    }
  };

  const handleFailure = (kind, error) => {
    if (kind !== 'timeout') {
      if (!close()) return;
      record({
        level: 'warn',
        module: 'electron.window',
        message: 'Window paint probe failed',
        data: {
          reason,
          ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
        },
      });
      return;
    }
    if (state.closed || state.timerDone) return;
    state.timerDone = true;

    const stillVisible = !win.isDestroyed() && win.isVisible() && !win.isMinimized();
    const focused = stillVisible && win.isFocused();
    const contentsGone = contents.isDestroyed();
    const loading = !contentsGone && contents.isLoadingMainFrame();
    const cpuPercent = contentsGone ? null : sampleCpuPercent();
    record({
      level: focused ? 'warn' : 'info',
      module: 'electron.window',
      message: 'Window paint probe timed out',
      data: {
        reason,
        focused,
        loading,
        cpuPercent,
      },
    });
    if (!focused || contentsGone) return;
    if (loading) {
      // The same pending probe can recover once loading completes.
      state.arm();
      return;
    }
    if (cpuPercent !== null && cpuPercent >= BUSY_RENDERER_CPU_PERCENT) {
      record({
        level: 'info',
        module: 'electron.window',
        message: 'Window reload suppressed by renderer activity',
        data: { reason, cpuPercent },
      });
      state.arm();
      return;
    }

    const lastReloadAt = lastPaintReloads.get(win);
    const elapsedMs = lastReloadAt === undefined ? reloadCooldownMs : now() - lastReloadAt;
    const cooldownRemainingMs = elapsedMs < 0 ? 0 : reloadCooldownMs - elapsedMs;
    if (cooldownRemainingMs > 0) {
      record({
        level: 'info',
        module: 'electron.window',
        message: 'Window reload suppressed by cooldown',
        data: { reason, cooldownRemainingMs },
      });
      return;
    }

    close();
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

  state.arm = () => {
    if (state.closed || !state.timerDone) return;
    state.timerDone = false;
    timer = schedule(() => handleFailure('timeout'), timeoutMs);
  };
  timer = schedule(() => handleFailure('timeout'), timeoutMs);

  try {
    contents.invalidate();
    contents.executeJavaScript(FRAME_PROBE_SCRIPT, false).then(
      () => close(),
      (error) => handleFailure('probe-failed', error),
    );
  } catch (error) {
    handleFailure('probe-failed', error);
  }
}

module.exports = { scheduleMinimizeToTray, probeWindowPaint };
