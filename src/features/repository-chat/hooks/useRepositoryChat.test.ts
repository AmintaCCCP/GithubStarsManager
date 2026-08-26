import { describe, expect, it } from 'vitest';
import { repositoryChatErrorMessage } from './useRepositoryChat';

describe('repositoryChatErrorMessage', () => {
  it('turns transient upstream failures into a safe, actionable Chinese retry message', () => {
    const message = repositoryChatErrorMessage(
      new Error('AI API error: 500 - {"error":{"message":"upstream error: do_request_failed"}}'),
      'zh'
    );

    expect(message).toContain('AI 服务暂时不可用');
    expect(message).toContain('请稍后重试');
    expect(message).not.toContain('do_request_failed');
    expect(message).not.toContain('500');
  });

  it('keeps non-transient failures actionable without exposing provider details', () => {
    const message = repositoryChatErrorMessage(new Error('provider-specific validation payload'), 'en');

    expect(message).toBe('Answer generation failed. Check the AI configuration and retry.');
    expect(message).not.toContain('provider-specific');
  });
});
