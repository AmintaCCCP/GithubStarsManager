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
    // hide() alone leaves the HWND iconic and parked off-screen, so the
    // taskbar button points at a minimized window that will not paint on restore.
    // Only Windows parks the compositor that way; other platforms can hide directly.
    if (process.platform === 'win32') win.restore();
    win.hide();
  });
}

function registerDidFinishLoadPaintProbe({ webContents, getWindow, scheduleProbe }) {
  webContents.on('did-finish-load', () => {
    const win = getWindow();
    if (win?.isVisible()) scheduleProbe('did-finish-load');
  });
}

const paintProbeStates = new WeakMap();
const lastWindowWakes = new WeakMap();
const BUSY_RENDERER_CPU_PERCENT = 20;
const BUSY_RENDERER_RETRY_LIMIT = 2;
// Avoid beginFrameSubscription here: electron/electron#37412 can crash the GPU
// process when frame capture overlaps window resizing. Two rAF turns still prove
// that the renderer/compositor BeginFrame pipeline resumed after invalidate().
const FRAME_PROBE_SCRIPT = `new Promise((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
})`;

/**
 * Ask Windows to drop a parked compositor by leaving and re-entering the
 * visible state. Reloading the page keeps the same window and does not (#533).
 */
function wakeParkedWindow(win) {
  if (win.isMinimized()) win.restore();
  win.hide();
  win.show();
  win.focus();
}

/**
 * Windows can resume a visible window without resuming its compositor (#533).
 * Force one repaint, then verify requestAnimationFrame resumes. When the
 * window is still focused and no frame arrives, wake the native window once
 * per cooldown. An occluded window is expected to stop producing frames.
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
    existing.reason = reason;
    try {
      contents.invalidate();
    } catch (error) {
      record({
        level: 'warn',
        module: 'electron.window',
        message: 'Window paint probe reuse invalidate failed',
        data: { reason, error: error instanceof Error ? error.message : String(error) },
      });
    }
    existing.restartRequested = true;
    existing.arm?.(true);
    return;
  }

  const state = {
    closed: false,
    timerDone: false,
    busyRetries: 0,
    deadlineAt: now() + timeoutMs * 3,
    restartRequested: false,
    reason,
    arm: null,
  };
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
          reason: state.reason,
          ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
        },
      });
      if (state.restartRequested && !contents.isDestroyed() && !contents.isLoadingMainFrame()) {
        probeWindowPaint({
          win,
          reason: state.reason,
          record,
          timeoutMs,
          reloadCooldownMs,
          now,
          getRendererCpuPercent,
          schedule,
          cancel,
        });
      }
      return;
    }
    if (state.closed || state.timerDone) return;
    state.timerDone = true;

    const stillVisible = !win.isDestroyed() && win.isVisible() && !win.isMinimized();
    const focused = stillVisible && win.isFocused();
    const contentsGone = contents.isDestroyed();
    const loading = !contentsGone && contents.isLoadingMainFrame();
    const cpuPercent = contentsGone ? null : sampleCpuPercent();
    if (focused && !contentsGone && loading) {
      record({
        level: 'info',
        module: 'electron.window',
        message: 'Window paint probe deferred while loading',
        data: { reason: state.reason },
      });
      close();
      return;
    }
    record({
      level: focused ? 'warn' : 'info',
      module: 'electron.window',
      message: 'Window paint probe timed out',
      data: {
        reason: state.reason,
        focused,
        loading,
        cpuPercent,
      },
    });
    if (!focused || contentsGone) return;
    if (cpuPercent !== null && cpuPercent >= BUSY_RENDERER_CPU_PERCENT) {
      state.busyRetries += 1;
      if (state.busyRetries > BUSY_RENDERER_RETRY_LIMIT) {
        record({
          level: 'warn',
          module: 'electron.window',
          message: 'Renderer busy retry limit reached',
          data: { reason: state.reason, cpuPercent, busyRetries: state.busyRetries },
        });
      } else {
        record({
          level: 'info',
          module: 'electron.window',
          message: 'Window wake suppressed by renderer activity',
          data: { reason: state.reason, cpuPercent, busyRetries: state.busyRetries },
        });
        state.arm();
        return;
      }
    } else {
      state.busyRetries = 0;
    }

    const lastWakeAt = lastWindowWakes.get(win);
    const elapsedMs = lastWakeAt === undefined ? reloadCooldownMs : now() - lastWakeAt;
    const cooldownRemainingMs = elapsedMs < 0 ? 0 : reloadCooldownMs - elapsedMs;
    if (cooldownRemainingMs > 0) {
      record({
        level: 'info',
        module: 'electron.window',
        message: 'Window wake suppressed by cooldown',
        data: { reason: state.reason, cooldownRemainingMs },
      });
      return;
    }

    close();
    lastWindowWakes.set(win, now());
    record({
      level: 'warn',
      module: 'electron.window',
      message: 'Waking window after frozen compositor',
      data: { reason: state.reason },
    });
    try {
      wakeParkedWindow(win);
    } catch (error) {
      record({
        level: 'error',
        module: 'electron.window',
        message: 'Window wake failed',
        data: { reason: state.reason, error: error instanceof Error ? error.message : String(error) },
      });
    }
  };

  state.arm = (restart = false) => {
    if (state.closed || (!restart && !state.timerDone)) return;
    if (state.timerDone) {
      state.deadlineAt = now() + timeoutMs * 3;
    } else {
      cancel(timer);
    }
    state.timerDone = false;
    const remainingMs = state.deadlineAt - now();
    timer = schedule(() => handleFailure('timeout'), Math.max(0, Math.min(timeoutMs, remainingMs)));
  };
  timer = schedule(() => handleFailure('timeout'), timeoutMs);
  // Establish the app.getAppMetrics() CPU measurement interval before timeout.
  sampleCpuPercent();

  try {
    contents.invalidate();
    contents.executeJavaScript(FRAME_PROBE_SCRIPT, false).then(
      () => {
        if (!close()) return;
        if (state.restartRequested && !contents.isDestroyed() && !contents.isLoadingMainFrame()) {
          probeWindowPaint({
            win,
            reason: state.reason,
            record,
            timeoutMs,
            reloadCooldownMs,
            now,
            getRendererCpuPercent,
            schedule,
            cancel,
          });
        }
      },
      (error) => handleFailure('probe-failed', error),
    );
  } catch (error) {
    handleFailure('probe-failed', error);
  }
}

module.exports = {
  scheduleMinimizeToTray,
  registerDidFinishLoadPaintProbe,
  probeWindowPaint,
};
