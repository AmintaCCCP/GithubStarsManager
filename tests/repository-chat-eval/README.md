# Repository chat eval（方案 §5.6）

两层回归：

- `chain.test.ts`：录制/构造的 GitHub 响应 + 固定模型输出，跑确定性链路断言（LLM 调用次数、轮次、快速路径、引用去重）。随 `npm run test:run` 进入 CI。
- `live.eval.ts`：真实 GitHub + 真实模型，逐题跑完整问答并输出 markdown 报告。默认跳过，需要显式开启。

## 运行真实评测

```bash
REPO_CHAT_EVAL_LIVE=1 \
EVAL_AI_BASE_URL=https://api.example.com/v1 \
EVAL_AI_API_KEY=sk-... \
EVAL_AI_MODEL=your-model \
GITHUB_TOKEN="$(gh auth token)" \
npm run eval:live
```

可选环境变量：

- `EVAL_CASES=install-astro,overview-zustand`：只跑指定用例。
- `EVAL_REPORT_PATH=/tmp/report.md`：报告输出路径；默认写入 `tests/repository-chat-eval/reports/`（已 gitignore）。
- `EVAL_DEBUG=1`：在控制台输出每题的证据、工具事件、指标和完整回答。

## 新增用例

在 `cases.ts` 的 `EVAL_CASES` 里追加：

```ts
{
  id: 'install-example',
  repo: 'owner/example',
  question: 'How do I install this?',
  language: 'en',
  mustInclude: ['npm install'],
  maxChars: 1_400,
  maxCitationRepeats: 3,
  fastPath: true,
  maxLlmCalls: 3,
  followUps: [{ question: 'What about Windows?', mustInclude: ['Windows'] }],
}
```

`fastPath` / `maxLlmCalls` / `maxRounds` 是可选的性能断言；不确定时先不写，跑一轮 `EVAL_DEBUG=1` 看真实指标再补。所有用例都会自动检查：引用格式、独立引用行、单来源重复次数（若设置）、以及不得出现“未证实”小节。
