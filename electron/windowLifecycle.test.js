const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { scheduleMinimizeToTray } = require('./windowLifecycle');

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
