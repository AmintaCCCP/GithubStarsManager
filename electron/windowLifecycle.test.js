const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { scheduleMinimizeToTray, probeWindowPaint } = require('./windowLifecycle');

function makeWindow({ minimized = true, destroyed = false } = {}) {
  return {
    hidden: false,
    minimized,
    destroyed,
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
});

function makeProbeWindow({
  focused = true,
  visible = true,
  minimized = false,
  loading = false,
  reloadError = null,
} = {}) {
  const timers = [];
  const records = [];
  let reloads = 0;
  let invalidations = 0;
  let resolveFrame;
  let rejectFrame;
  const win = {
    webContents: {
      executeJavaScript() {
        return new Promise((resolve, reject) => {
          resolveFrame = resolve;
          rejectFrame = reject;
        });
      },
      invalidate() {
        invalidations += 1;
      },
      isLoadingMainFrame() {
        return loading;
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
    isVisible: () => visible,
    isMinimized: () => minimized,
    isFocused: () => focused,
  };

  return {
    win,
    records,
    get reloads() {
      return reloads;
    },
    get invalidations() {
      return invalidations;
    },
    get resolveFrame() {
      return resolveFrame;
    },
    get rejectFrame() {
      return rejectFrame;
    },
    schedule(callback) {
      timers.push(callback);
      return timers.length;
    },
    cancel() {},
    runTimers() {
      for (const callback of timers.splice(0)) callback();
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
    assert.equal(probe.invalidations, 1);

    probe.resolveFrame();
    await Promise.resolve();
    run();
    assert.equal(probe.invalidations, 2);
  });

  it('reloads a focused window when no frame arrives', () => {
    const probe = makeProbeWindow();
    probeWindowPaint({
      win: probe.win,
      reason: 'focus',
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    probe.runTimers();

    assert.equal(probe.reloads, 1);
    assert.deepEqual(
      probe.records.map((entry) => entry.message),
      ['Window paint probe timed out', 'Reloading window after frozen compositor'],
    );
  });

  it('does not reload repeatedly during the cooldown window', () => {
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
    assert.equal(probe.reloads, 1);

    currentTime += 1_000;
    run();
    probe.runTimers();
    assert.equal(probe.reloads, 1);
    assert.equal(probe.records.at(-1).message, 'Window reload suppressed by cooldown');

    currentTime += 60_000;
    run();
    probe.runTimers();
    assert.equal(probe.reloads, 2);
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
  });

  it('does not reload an unfocused, occluded window', () => {
    const probe = makeProbeWindow({ focused: false });
    probeWindowPaint({
      win: probe.win,
      reason: 'display-metrics-changed',
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    probe.runTimers();

    assert.equal(probe.reloads, 0);
    assert.equal(probe.records[0].level, 'info');
    assert.equal(probe.records[0].data.focused, false);
  });

  it('does not reload while the main frame is still loading', () => {
    const probe = makeProbeWindow({ loading: true });
    probeWindowPaint({
      win: probe.win,
      reason: 'show',
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    probe.runTimers();

    assert.equal(probe.reloads, 0);
    assert.equal(probe.records[0].data.loading, true);
  });

  it('records a failed reload instead of throwing from the timer', () => {
    const probe = makeProbeWindow({ reloadError: new Error('reload failed') });
    probeWindowPaint({
      win: probe.win,
      reason: 'focus',
      record: (entry) => probe.records.push(entry),
      schedule: probe.schedule,
      cancel: probe.cancel,
    });

    assert.doesNotThrow(() => probe.runTimers());
    assert.equal(probe.records.at(-1).message, 'Window reload failed');
  });
});
