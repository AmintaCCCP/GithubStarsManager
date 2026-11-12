import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyRequestMock = vi.fn();

vi.mock('../../src/db/connection.js', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: (keyOrId: string) => {
        if (sql.includes('FROM ai_configs')) {
          if (keyOrId === 'ai-saved-1') {
            return {
              id: 'ai-saved-1',
              api_type: 'openai-compatible',
              base_url: 'http://127.0.0.1:11434/v1',
              api_key_encrypted: 'mock-key',
              model: 'llama3:latest',
            };
          }
          return undefined;
        }
        if (sql.includes('FROM settings')) {
          return undefined;
        }
        return undefined;
      },
    }),
  }),
}));

vi.mock('../../src/services/crypto.js', () => ({
  decrypt: (value: string) => value,
  encrypt: (value: string) => value,
}));

vi.mock('../../src/services/proxyService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/proxyService.js')>();
  return {
    ...actual,
    validateUrl: vi.fn(),
    proxyRequest: proxyRequestMock,
  };
});

const { default: proxyRouter } = await import('../../src/routes/proxy.js');

const createTestApp = () => {
  const app = express();
  app.use(express.json());
  app.use(proxyRouter);
  return app;
};

describe('AI proxy route (/api/proxy/ai)', () => {
  beforeEach(() => {
    proxyRequestMock.mockReset();
    proxyRequestMock.mockResolvedValue({
      status: 200,
      data: { choices: [{ message: { content: 'OK' } }] },
      headers: {},
    });
  });

  it('passes allowPrivate: true for unsaved inline config (local 127.0.0.1 test connection, fixes #602)', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/api/proxy/ai')
      .send({
        config: {
          apiType: 'openai-compatible',
          baseUrl: 'http://127.0.0.1:11434/v1',
          apiKey: 'ollama',
          model: 'llama3',
        },
        body: {
          messages: [{ role: 'user', content: 'Reply with exactly one word: OK' }],
        },
      });

    expect(response.status).toBe(200);
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
    const callArgs = proxyRequestMock.mock.calls[0][0];
    expect(callArgs.allowPrivate).toBe(true);
    expect(callArgs.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(callArgs.method).toBe('POST');
  });

  it('passes allowPrivate: true for LAN and HTTP endpoints in inline config', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/api/proxy/ai')
      .send({
        config: {
          apiType: 'openai-compatible',
          baseUrl: 'http://192.168.1.100:11434/v1',
          apiKey: 'test-key',
          model: 'qwen2.5:7b',
        },
        body: {
          messages: [{ role: 'user', content: 'hello' }],
        },
      });

    expect(response.status).toBe(200);
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
    const callArgs = proxyRequestMock.mock.calls[0][0];
    expect(callArgs.allowPrivate).toBe(true);
    expect(callArgs.url).toBe('http://192.168.1.100:11434/v1/chat/completions');
  });

  it('passes allowPrivate: true for saved config via configId', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/api/proxy/ai')
      .send({
        configId: 'ai-saved-1',
        body: {
          messages: [{ role: 'user', content: 'test' }],
        },
      });

    expect(response.status).toBe(200);
    expect(proxyRequestMock).toHaveBeenCalledTimes(1);
    const callArgs = proxyRequestMock.mock.calls[0][0];
    expect(callArgs.allowPrivate).toBe(true);
    expect(callArgs.url).toBe('http://127.0.0.1:11434/v1/chat/completions');
  });

  it('returns 400 when neither configId nor valid inline config is provided', async () => {
    const app = createTestApp();

    const response = await request(app)
      .post('/api/proxy/ai')
      .send({
        body: { messages: [] },
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('CONFIG_ID_REQUIRED');
  });
});
