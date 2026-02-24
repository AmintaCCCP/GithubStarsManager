import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: './',
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  css: false,
});
