import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installDiagnosticsBridge,
  resetDiagnosticsBridgeForTest,
  getPendingCountForTest,
} from './diagnosticsBridge';
import { logger, type LogEntry } from './logger';

interface AppendPayload { debugMode: boolean; entries: LogEntry[] }

const appendMock = vi.fn(async (payload: AppendPayload) => ({ success: true, accepted: payload.entries.length }));
const flushPayloads: AppendPayload[] = [];
const flushSendMock = vi.fn((payload: AppendPayload) => { flushPayloads.push(payload); });

function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: `t-${Math.random().toString(36).slice(2)}`,
    timestamp: new Date().toISOString(),
    level: 'info',
    module: 'test',
    message: 'message',
    source: 'frontend',
    ...overrides,
  };
}

function dispatch(entry: LogEntry): void {
  window.dispatchEvent(new CustomEvent('gsm:diagnostic-log-added', { detail: entry }));
}

describe('diagnosticsBridge', () => {
  beforeEach(() => {
    resetDiagnosticsBridgeForTest();
    appendMock.mockClear();
    flushSendMock.mockClear();
    flushPayloads.length = 0;
    sessionStorage.setItem('gsm:frontend-debug', 'false');
    // Logger is a module-level singleton; its ring buffer is shared across
    // tests and would otherwise leak entries into the backfill.
    logger.clear();
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      diagnostics: {
        append: appendMock,
        flush: flushSendMock,
        read: vi.fn(),
        exportBundle: vi.fn(),
      },
    };
  });

  afterEach(() => {
    resetDiagnosticsBridgeForTest();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('persists warn/error in normal mode and drops info/debug', () => {
    installDiagnosticsBridge();
    dispatch(makeEntry({ level: 'info' }));
    dispatch(makeEntry({ level: 'debug' }));
    expect(getPendingCountForTest()).toBe(0);
    dispatch(makeEntry({ level: 'warn' }));
    dispatch(makeEntry({ level: 'error' }));
    expect(getPendingCountForTest()).toBe(2);
  });

  it('persists everything in debug mode', () => {
    sessionStorage.setItem('gsm:frontend-debug', 'true');
    installDiagnosticsBridge();
    dispatch(makeEntry({ level: 'info' }));
    dispatch(makeEntry({ level: 'debug' }));
    expect(getPendingCountForTest()).toBe(2);
  });

  it('flushes a batch over invoke when the threshold (32) is reached', async () => {
    installDiagnosticsBridge();
    for (let i = 0; i < 32; i++) {
      dispatch(makeEntry({ level: 'warn', message: `m${i}` }));
    }
    await vi.waitFor(() => expect(appendMock).toHaveBeenCalled());
    const payload = appendMock.mock.calls[0]![0];
    expect(payload.debugMode).toBe(false);
    expect(payload.entries).toHaveLength(32);
  });

  it('aggregates identical module+level+message repeats with repeatCount', () => {
    installDiagnosticsBridge();
    dispatch(makeEntry({ level: 'warn', module: 'same', message: 'same text' }));
    dispatch(makeEntry({ level: 'warn', module: 'same', message: 'same text' }));
    dispatch(makeEntry({ level: 'warn', module: 'same', message: 'same text' }));
    expect(getPendingCountForTest()).toBe(1);
  });

  it('flushes over one-way send on pagehide', () => {
    installDiagnosticsBridge();
    dispatch(makeEntry({ level: 'error', message: 'last words' }));
    window.dispatchEvent(new Event('pagehide'));
    expect(flushSendMock).toHaveBeenCalledTimes(1);
    expect(flushPayloads[0]!.entries[0].message).toBe('last words');
    expect(getPendingCountForTest()).toBe(0);
  });

  it('drops non-error entries beyond 100/s and records a suppression marker', async () => {
    installDiagnosticsBridge();
    for (let i = 0; i < 150; i++) {
      dispatch(makeEntry({ level: 'warn', message: `flood ${i}` }));
    }
    dispatch(makeEntry({ level: 'error', message: 'still visible' }));
    dispatch(makeEntry({ level: 'warn', message: 'suppressed as well' }));
    // Push pending past the threshold so the flush emits the marker.
    for (let i = 0; i < 32; i++) {
      dispatch(makeEntry({ level: 'error', message: `flush trigger ${i}` }));
    }
    await vi.waitFor(() => expect(appendMock).toHaveBeenCalled());
    const allEntries = appendMock.mock.calls.flatMap((call) => call[0].entries as LogEntry[]);
    const marker = allEntries.find((e) => e.module === 'diagnosticsBridge');
    expect(marker).toBeTruthy();
    expect(marker?.message).toContain('dropped 51');
    expect(allEntries.some((e) => e.message === 'still visible')).toBe(true);
    expect(allEntries.some((e) => e.message === 'suppressed as well')).toBe(false);
  });

  it('backfills Logger ring-buffer entries that predate installation', async () => {
    logger.error('early', 'logged before bridge install');
    installDiagnosticsBridge();
    await vi.waitFor(() => expect(appendMock).toHaveBeenCalled());
    const firstPayload = appendMock.mock.calls[0]![0];
    expect(firstPayload.entries.some((e: LogEntry) => e.module === 'early')).toBe(true);
  });

  it('resets pending state on the logs-cleared event', () => {
    installDiagnosticsBridge();
    dispatch(makeEntry({ level: 'warn' }));
    expect(getPendingCountForTest()).toBe(1);
    window.dispatchEvent(new CustomEvent('gsm:diagnostic-logs-cleared'));
    expect(getPendingCountForTest()).toBe(0);
  });

  it('is a no-op buffer in web mode (no electronAPI.diagnostics)', async () => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    installDiagnosticsBridge();
    dispatch(makeEntry({ level: 'error' }));
    expect(getPendingCountForTest()).toBe(0);
    window.dispatchEvent(new Event('pagehide'));
    expect(flushSendMock).not.toHaveBeenCalled();
  });
});
