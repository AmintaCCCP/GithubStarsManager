import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { fetch as undiciFetch } from 'undici';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AIConfig } from '../../src/types';
import { EVAL_CASES } from './cases';
import { runEvalCase, toMarkdownReport, type EvalResult } from './harness';

/**
 * 真实用例评测（方案 §5.6 的 npm run eval:live）：真实 GitHub + 真实模型，
 * 逐题运行完整问答链路并输出 markdown 报告。默认不跑（CI 无密钥）。
 *
 * 环境变量：
 * - REPO_CHAT_EVAL_LIVE=1
 * - EVAL_AI_BASE_URL / EVAL_AI_API_KEY / EVAL_AI_MODEL
 * - GITHUB_TOKEN（未设置时读取 `gh auth token` 的结果，由调用方注入）
 * - EVAL_CASES（逗号分隔的 case id，可选）
 * - EVAL_REPORT_PATH（报告输出路径，可选）
 */

const enabled = process.env.REPO_CHAT_EVAL_LIVE === '1';
const filter = (process.env.EVAL_CASES ?? '').split(',').map((value) => value.trim()).filter(Boolean);
const cases = filter.length > 0 ? EVAL_CASES.filter((evalCase) => filter.includes(evalCase.id)) : EVAL_CASES;
if (enabled && filter.length > 0 && cases.length === 0) {
  throw new Error(`EVAL_CASES 没有匹配任何用例：${filter.join(', ')}`);
}
const reportPath = process.env.EVAL_REPORT_PATH
  ?? resolve(process.cwd(), `tests/repository-chat-eval/reports/live-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);

const aiConfig: AIConfig = {
  id: 'eval-live',
  name: 'eval-live',
  apiType: 'openai-compatible',
  baseUrl: process.env.EVAL_AI_BASE_URL ?? '',
  apiKey: process.env.EVAL_AI_API_KEY ?? '',
  model: process.env.EVAL_AI_MODEL ?? '',
  isActive: true,
};

const githubToken = process.env.GITHUB_TOKEN ?? '';
const results: EvalResult[] = [];

beforeAll(() => {
  if (!enabled) return;
  // setup.ts 用 vi.fn() 替换了 window.fetch；真实评测恢复 Node 的 fetch。
  vi.stubGlobal('fetch', undiciFetch);
  Object.defineProperty(window, 'fetch', { configurable: true, writable: true, value: undiciFetch });
});

afterAll(() => {
  if (!enabled || results.length === 0) return;
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, toMarkdownReport(results, {
    model: aiConfig.model,
    baseUrl: aiConfig.baseUrl,
    generatedAt: new Date().toISOString(),
  }));
  console.log(`[repository-chat-eval] report: ${reportPath}`);
});

describe.skipIf(!enabled)('repository chat live eval', () => {
  beforeAll(() => {
    // 凭据不完整时在这里直接失败，阻止后续用例先消耗 GitHub 配额。
    expect(aiConfig.baseUrl, 'EVAL_AI_BASE_URL').not.toBe('');
    expect(aiConfig.apiKey, 'EVAL_AI_API_KEY').not.toBe('');
    expect(aiConfig.model, 'EVAL_AI_MODEL').not.toBe('');
    expect(githubToken, 'GITHUB_TOKEN').not.toBe('');
  });

  for (const evalCase of cases) {
    it(evalCase.id, async () => {
      let result: EvalResult;
      try {
        result = await runEvalCase(evalCase, { githubToken, aiConfig });
      } catch (error) {
        // 执行异常也要进报告：否则该用例从 Markdown 里消失，看起来像全过。
        result = {
          caseId: evalCase.id,
          repo: evalCase.repo,
          sha: '',
          content: '',
          evidences: [],
          metrics: null,
          toolEvents: [],
          failures: [`error: ${error instanceof Error ? error.message : String(error)}`],
          answers: [],
        };
      }
      results.push(result);
      if (process.env.EVAL_DEBUG) {
        console.log(JSON.stringify({
          caseId: result.caseId,
          metrics: result.metrics,
          evidences: result.evidences.map((evidence) => ({
            path: evidence.path, lines: [evidence.lineStart, evidence.lineEnd], chars: evidence.excerpt.length,
          })),
          events: result.toolEvents.map((event) => `${event.status} ${event.toolName} r${event.round ?? '-'} ${event.paramSummary}${event.detail ? ` :: ${event.detail.slice(0, 160)}` : ''}`),
          answer: result.content,
          followUpAnswers: result.answers.slice(1),
        }, null, 2));
      }
      expect(result.failures).toEqual([]);
    }, 300_000);
  }
});
