const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  scheduleMinimizeToTray,
  registerDidFinishLoadPaintProbe,
  probeWindowPaint,
} = require('./windowLifecycle');

function makeWindow({ minimized = true, destroyed = false } = {}) {
  return {
    hidden: false,
    minimized,
    destroyed,
    restore() {
      this.minimized = false;
    },
    hide() {
      this.hidden = true;
    },
    isDestroyed() {
      return this.destroyed;
    },
    isMinimized() {
      return this.minimized;
    },
  };
}

describe('scheduleMinimizeToTray', () => {
  it('defers hide until after the native minimize dispatch', () => {
    const win = makeWindow();
    let deferred;

    scheduleMinimizeToTray({
      win,
      shouldHide: () => true,
      schedule: (callback) => {
        deferred = callback;
      },
    });

    assert.equal(win.hidden, false);
    deferred();
    assert.equal(win.hidden, true);
  });

  it('does not schedule when minimize-to-tray is disabled', () => {
    const win = makeWindow();
    let scheduled = false;

    scheduleMinimizeToTray({
      win,
      shouldHide: () => false,
      schedule: () => {
        scheduled = true;
      },
    });

    assert.equal(scheduled, false);
    assert.equal(win.hidden, false);
  });

  it('skips a stale hide if the window was restored first', () => {
    const win = makeWindow();
    let deferred;

    scheduleMinimizeToTray({
      win,
      shouldHide: () => true,
      schedule: (callback) => {
        deferred = callback;
      },
    });
    win.minimized = false;
    deferred();

    assert.equal(win.hidden, false);
  });

  it('rechecks the preference and destroyed state at fire time', () => {
    let enabled = true;
    const win = makeWindow();
    const callbacks = [];

    scheduleMinimizeToTray({
      win,
      shouldHide: () => enabled,
      schedule: (callback) => callbacks.push(callback),
    });
    enabled = false;
    callbacks[0]();
    assert.equal(win.hidden, false);

    enabled = true;
    scheduleMinimizeToTray({
      win,
      shouldHide: () => enabled,
      schedule: (callback) => callbacks.push(callback),
    });
    win.destroyed = true;
    callbacks[1]();
    assert.equal(win.hidden, false);
  });

  it('hides without restoring, leaving iconic cleanup to tray-show', () => {
    const calls = [];
    const win = makeWindow();
    win.restore = () => calls.push('restore');
    win.hide = () => {
      calls.push('hide');
      win.hidden = true;
    };

    scheduleMinimizeToTray({
      win,
      shouldHide: () => true,
      schedule: (callback) => callback(),
    });

    assert.deepEqual(calls, ['hide']);
  });
});

describe('registerDidFinishLoadPaintProbe', () => {
  it('schedules a probe after did-finish-load when the window is visible', () => {
    const webContents = new EventEmitter();
    let visible = false;
    const reasons = [];

    registerDidFinishLoadPaintProbe({
      webContents,
      getWindow: () => ({ isVisible: () => visible }),
      scheduleProbe: (reason) => reasons.push(reason),
    });

    webContents.emit('did-finish-load');
    assert.deepEqual(reasons, []);

    visible = true;
    webContents.emit('did-finish-load');
    assert.deepEqual(reasons, ['did-finish-load']);
  });

  it('is wired into the Electron main process', () => {
    const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
    assert.match(source, /registerDidFinishLoadPaintProbe\(\{/);
  });

  it('disables native window occlusion before the app is ready', () => {
    const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
    const readyAt = source.indexOf('app.whenReady(');
    const switchAt = source.search(
      /^\s*app\.commandLine\.appendSwitch\('disable-features', 'CalculateNativeWinOcclusion'\)/m,
    );
    assert.ok(switchAt > 0 && switchAt < readyAt);
    assert.match(
      source,
      /^if \(process\.platform === 'win32'\) \{\n\s*app\.commandLine\.appendSwitch\('disable-features', 'CalculateNativeWinOcclusion'\)/m,
    );
  });
});

function makeProbeWindow({
  focused = true,
  visible = true,
  minimized = false,
  loading = false,
  reloadError = null,
} = {}) {
  const timers = new Map();
  const scheduleDelays = [];
  let scheduledTimerCount = 0;
  const records = [];
  const scripts = [];
  let reloads = 0;
  let invalidations = 0;
  let wakeError = null;
  const wakeSteps = [];
  let resolveFrame;
  let rejectFrame;
  let focusedState = focused;
  let visibleState = visible;
  let minimizedState = minimized;
  let loadingState = loading;
  let cpuPercent = null;
  let invalidateError = null;
  const win = {
    webContents: {
      executeJavaScript(script) {
        scripts.push(script);
        return new Promise((resolve, reject) => {
          resolveFrame = resolve;
          rejectFrame = reject;
        });
      },
      invalidate() {
        if (invalidateError) throw invalidateError;
        invalidations += 1;
      },
      isLoadingMainFrame() {
        return loadingState;
      },
      isDestroyed() {
        return false;
      },
      reload() {
        if (reloadError) throw reloadError;
        reloads += 1;
      },
    },
    isDestroyed: () => false,
    isVisible: () => visibleState,
    isMinimized: () => minimizedState,
    isFocused: () => focusedState,
    restore() {
      if (wakeError) throw wakeError;
      wakeSteps.push('restore');
      minimizedState = false;
    },
    hide() {
      if (wakeError) throw wakeError;
      wakeSteps.push('hide');
    },
    show() {
      if (wakeError) throw wakeError;
      wakeSteps.push('show');
    },
    focus() {
      if (wakeError) throw wakeError;
      wakeSteps.push('focus');
    },
  };

  return {
    win,
    records,
    scripts,
    get cpuPercent() {
      return cpuPercent;
    },
    set cpuPercent(value) {
      cpuPercent = value;
    },
    set invalidateError(value) {
      invalidateError = value;
    },
    get reloads() {
      return reloads;
    },
    get wakeSteps() {
      return wakeSteps;
    },
    set wakeError(value) {
      wakeError = value;
    },
    get invalidations() {
      return invalidations;
    },
    get timerCount() {
      return timers.size;
    },
    get activeTimerIds() {
      return [...timers.keys()];
    },
    get scheduledTimerCount() {
      return scheduledTimerCount;
    },
    get scheduleDelays() {
      return scheduleDelays;
    },
    get resolveFrame() {
      return resolveFrame;
    },
    get rejectFrame() {
      return rejectFrame;
    },
    schedule(callback, delay) {
      const timer = ++scheduledTimerCount;
      timers.set(timer, callback);
      scheduleDelays.push(delay);
      return timer;
    },
    cancel(timer) {
      timers.delete(timer);
    },
    runTimers() {
      const pending = [...timers.values()];
      timers.clear();
      for (const callback of pending) callback();
    },
    setState(next) {
      if ('focused' in next) focusedState = next.focused;
      if ('visible' in next) visibleState = next.visible;
      if ('minimized' in next) minimizedState = next.minimized;
      if ('loading' in next) loadingState = next.loading;
    },
  };
}

describe('probeWindowPaint', () => {
  it('finishes cleanly when requestAnimationFrame resumes', async () => {
    const probe = makeProbeWindow();
    probeWindowPaint({
      win: probe.win,
      reason: 'focus',
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    assert.equal(probe.invalidations, 1);
    assert.match(probe.scripts[0], /requestAnimationFrame\(\(\) => requestAnimationFrame/);
    probe.resolveFrame();
    await Promise.resolve();
    probe.runTimers();

    assert.deepEqual(probe.records, []);
    assert.equal(probe.reloads, 0);
  });

  it('does not overlap probes for the same window', async () => {
    const probe = makeProbeWindow();
    const run = () => probeWindowPaint({
      win: probe.win,
      reason: 'focus',
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    run();
    run();
    assert.equal(probe.invalidations, 2);
    assert.equal(probe.scripts.length, 1);

    probe.resolveFrame();
    await Promise.resolve();
    run();
    assert.equal(probe.invalidations, 4);
    assert.equal(probe.scripts.length, 2);
  });

  it('records a reuse invalidate failure without starting another script', () => {
    const probe = makeProbeWindow();
    const run = (reason) => probeWindowPaint({
      win: probe.win,
      reason,
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    run('show');
    probe.invalidateError = new Error('invalidate failed');
    run('focus');

    assert.equal(probe.records[0].message, 'Window paint probe reuse invalidate failed');
    assert.equal(probe.records[0].data.reason, 'focus');
    assert.equal(probe.records[0].data.error, 'invalidate failed');
    assert.equal(probe.scripts.length, 1);
    assert.equal(probe.timerCount, 1);
  });

  it('uses the latest event reason for an active probe timeout', () => {
    const probe = makeProbeWindow();
    const run = (reason) => probeWindowPaint({
      win: probe.win,
      reason,
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    run('show');
    run('display-metrics-changed');
    probe.runTimers();

    assert.equal(probe.records[0].message, 'Window paint probe timed out');
    assert.equal(probe.records[0].data.reason, 'display-metrics-changed');
  });

  it('wakes a focused window when no frame arrives', () => {
    const probe = makeProbeWindow();
    probeWindowPaint({
      win: probe.win,
      reason: 'focus',
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    probe.runTimers();

    assert.equal(probe.reloads, 0);
    assert.deepEqual(probe.wakeSteps, ['hide', 'show', 'focus']);
    assert.deepEqual(
      probe.records.map((entry) => entry.message),
      ['Window paint probe timed out', 'Waking window after frozen compositor'],
    );
  });

  it('does not wake repeatedly during the cooldown window', () => {
    const probe = makeProbeWindow();
    let currentTime = 1_000;
    const run = () => probeWindowPaint({
      win: probe.win,
      reason: 'focus',
      record: (entry) => probe.records.push(entry),
      now: () => currentTime,
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    run();
    probe.runTimers();
    assert.deepEqual(probe.wakeSteps, ['hide', 'show', 'focus']);

    currentTime += 1_000;
    run();
    probe.runTimers();
    assert.deepEqual(probe.wakeSteps, ['hide', 'show', 'focus']);
    assert.equal(probe.records.at(-1).message, 'Window wake suppressed by cooldown');

    currentTime += 60_000;
    run();
    probe.runTimers();
    assert.deepEqual(probe.wakeSteps, ['hide', 'show', 'focus', 'hide', 'show', 'focus']);
  });

  it('treats a backward clock jump as an expired cooldown', () => {
    const probe = makeProbeWindow();
    let currentTime = 10_000;
    const run = () => probeWindowPaint({
      win: probe.win,
      reason: 'focus',
      record: (entry) => probe.records.push(entry),
      now: () => currentTime,
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    run();
    probe.runTimers();
    currentTime -= 1_000;
    run();
    probe.runTimers();

    assert.equal(probe.reloads, 0);
    assert.deepEqual(probe.wakeSteps, ['hide', 'show', 'focus', 'hide', 'show', 'focus']);
  });

  it('samples CPU at probe start to establish a baseline', () => {
    const probe = makeProbeWindow();
    let samples = 0;
    probeWindowPaint({
      win: probe.win,
      reason: 'focus',
      record: (entry) => probe.records.push(entry),
      getRendererCpuPercent: () => {
        samples += 1;
        return 0;
      },
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    assert.equal(samples, 1);
    probe.runTimers();
    assert.equal(samples, 2);
  });

  it('wakes after the renderer stays busy past the retry limit', () => {
    const probe = makeProbeWindow();
    probe.cpuPercent = 75;
    const run = () => probeWindowPaint({
      win: probe.win,
      reason: 'focus',
      record: (entry) => probe.records.push(entry),
      getRendererCpuPercent: () => probe.cpuPercent,
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    run();
    probe.runTimers();

    assert.equal(probe.reloads, 0);
    assert.deepEqual(probe.wakeSteps, []);
    assert.equal(probe.records.at(-1).message, 'Window wake suppressed by renderer activity');

    probe.runTimers();
    assert.deepEqual(probe.wakeSteps, []);

    probe.runTimers();
    assert.equal(probe.reloads, 0);
    assert.deepEqual(probe.wakeSteps, ['hide', 'show', 'focus']);
    assert.deepEqual(
      probe.records.slice(-2).map((entry) => entry.message),
      ['Renderer busy retry limit reached', 'Waking window after frozen compositor'],
    );
  });

  it('wakes when the renderer becomes idle before the retry limit', () => {
    const probe = makeProbeWindow();
    probe.cpuPercent = 75;
    const run = () => probeWindowPaint({
      win: probe.win,
      reason: 'focus',
      record: (entry) => probe.records.push(entry),
      getRendererCpuPercent: () => probe.cpuPercent,
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    run();
    probe.runTimers();
    probe.cpuPercent = 0;
    probe.runTimers();

    assert.equal(probe.reloads, 0);
    assert.deepEqual(probe.wakeSteps, ['hide', 'show', 'focus']);
    assert.equal(probe.records.at(-1).message, 'Waking window after frozen compositor');
  });

  it('records a failed renderer probe without throwing', async () => {
    const probe = makeProbeWindow();
    probeWindowPaint({
      win: probe.win,
      reason: 'focus',
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    probe.rejectFrame(new Error('renderer gone'));
    await Promise.resolve();

    assert.equal(probe.records[0].message, 'Window paint probe failed');
    assert.equal(probe.records[0].data.error, 'renderer gone');
    assert.equal(probe.reloads, 0);
    assert.equal(probe.scripts.length, 1);
  });

  it('starts a fresh probe when an old script rejects after a new window event', async () => {
    const probe = makeProbeWindow();
    const run = () => probeWindowPaint({
      win: probe.win,
      reason: 'focus',
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    run();
    run();
    probe.rejectFrame(new Error('navigation'));
    await Promise.resolve();

    assert.equal(probe.records[0].message, 'Window paint probe failed');
    assert.equal(probe.scripts.length, 2);
    assert.equal(probe.timerCount, 1);

    probe.resolveFrame();
    await Promise.resolve();
    probe.runTimers();
    assert.equal(probe.reloads, 0);
  });

  it('starts a fresh probe when an old script resolves after a new window event', async () => {
    const probe = makeProbeWindow();
    const run = () => probeWindowPaint({
      win: probe.win,
      reason: 'focus',
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    run();
    run();
    probe.resolveFrame();
    await Promise.resolve();

    assert.equal(probe.scripts.length, 2);
    assert.equal(probe.timerCount, 1);

    probe.resolveFrame();
    await Promise.resolve();
    probe.runTimers();
    assert.equal(probe.reloads, 0);
  });

  it('reuses one pending script and re-arms after focus returns', () => {
    const probe = makeProbeWindow();
    const run = () => probeWindowPaint({
      win: probe.win,
      reason: 'display-metrics-changed',
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    probe.setState({ focused: false });
    run();
    assert.equal(probe.timerCount, 1);
    probe.runTimers();
    assert.equal(probe.reloads, 0);
    assert.equal(probe.records[0].level, 'info');
    assert.equal(probe.records[0].data.focused, false);

    probe.setState({ focused: true });
    run();
    assert.equal(probe.timerCount, 1);
    probe.runTimers();

    assert.equal(probe.reloads, 0);
    assert.deepEqual(probe.wakeSteps, ['hide', 'show', 'focus']);
    assert.equal(probe.scripts.length, 1);
  });

  it('restarts the pending timeout when a new window event arrives', () => {
    const probe = makeProbeWindow();
    const run = () => probeWindowPaint({
      win: probe.win,
      reason: 'display-metrics-changed',
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    run();
    const staleTimer = probe.scheduledTimerCount;
    probe.setState({ focused: false });
    run();
    probe.setState({ focused: true });
    run();

    assert.equal(probe.timerCount, 1);
    assert.deepEqual(probe.activeTimerIds, [3]);
    assert.equal(probe.scheduledTimerCount, 3);
    assert.equal(probe.scripts.length, 1);
    assert.equal(probe.invalidations, 3);
    assert.equal(staleTimer, 1);
    probe.runTimers();
    assert.equal(probe.reloads, 0);
    assert.deepEqual(probe.wakeSteps, ['hide', 'show', 'focus']);
  });

  it('caps repeated timeout restarts at the original probe deadline', () => {
    const probe = makeProbeWindow();
    let currentTime = 0;
    const run = () => probeWindowPaint({
      win: probe.win,
      reason: 'focus',
      record: (entry) => probe.records.push(entry),
      now: () => currentTime,
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    run();
    currentTime = 4_000;
    run();
    currentTime = 9_000;
    run();
    currentTime = 13_000;
    run();

    assert.deepEqual(probe.scheduleDelays, [5_000, 5_000, 5_000, 2_000]);
  });

  it('does not reload while the main frame is still loading', () => {
    const probe = makeProbeWindow({ loading: true });
    const run = () => probeWindowPaint({
      win: probe.win,
      reason: 'show',
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    run();
    probe.runTimers();

    assert.equal(probe.reloads, 0);
    assert.equal(probe.records[0].message, 'Window paint probe deferred while loading');
    assert.equal(probe.timerCount, 0);

    probe.setState({ loading: false });
    run();
    probe.runTimers();
    assert.equal(probe.reloads, 0);
    assert.deepEqual(probe.wakeSteps, ['hide', 'show', 'focus']);
  });

  it('records a failed wake instead of throwing from the timer', () => {
    const probe = makeProbeWindow();
    probe.wakeError = new Error('wake failed');
    probeWindowPaint({
      win: probe.win,
      reason: 'focus',
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    assert.doesNotThrow(() => probe.runTimers());
    assert.equal(probe.reloads, 0);
    assert.equal(probe.records.at(-1).message, 'Window wake failed');
    assert.equal(probe.records.at(-1).data.error, 'wake failed');
  });
});
