import { describe, expect, it } from 'vitest';
import { validatePluginPageMessage } from './pluginPageMessages';

const frameWindow = {} as Window;
const request = {
  type: 'plugin-page:request', pluginId: 'com.example.page', pageId: 'dashboard',
  requestId: 'request_1', token: 'secret-session-token',
  method: 'repositories.search', args: { query: 'react', limit: 5 },
};

function event(data: unknown, source: MessageEventSource | null = frameWindow, origin = 'null'): MessageEvent {
  return { data, source, origin } as MessageEvent;
}

describe('plugin page message validation', () => {
  it('accepts only the current frame, opaque origin, page identity and session token', () => {
    const validate = (message: MessageEvent) => validatePluginPageMessage(
      message, frameWindow, 'com.example.page', 'dashboard', 'secret-session-token',
    );
    expect(validate(event(request))).toEqual(request);
    expect(validate(event(request, {} as Window))).toBeNull();
    expect(validate(event(request, frameWindow, 'https://attacker.example'))).toBeNull();
    expect(validate(event({ ...request, token: 'wrong' }))).toBeNull();
    expect(validate(event({ ...request, pluginId: 'com.other.page' }))).toBeNull();
    expect(validate(event({ ...request, requestId: '../invalid' }))).toBeNull();
    expect(validate(event({ ...request, extra: 'x' }))).toBeNull();
  });
});
