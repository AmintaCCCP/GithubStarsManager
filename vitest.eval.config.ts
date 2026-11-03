import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/** 真实模型评测（npm run eval:live）；不进 CI，需显式设置 REPO_CHAT_EVAL_LIVE=1。 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost' } },
    include: ['tests/repository-chat-eval/**/*.eval.ts'],
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
});
