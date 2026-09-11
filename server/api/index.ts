/**
 * Vercel serverless 入口。
 *
 * 通过 serverless-http 包装现有 Express app；数据库由 db/client.ts 门面根据
 * 环境变量自动选择：Vercel 注入的 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN 走
 * Turso 远程 libSQL，否则回退本地 better-sqlite3。
 *
 * 每次冷启动先确保 schema 已就绪（建表幂等，Turso 云端持久）。
 */
import serverless from 'serverless-http';
import { createApp } from '../index.js';
import { runMigrations } from '../db/migrations.js';

let cachedHandler: ReturnType<typeof serverless> | null = null;

async function buildHandler() {
  await runMigrations();
  const app = createApp();
  return serverless(app);
}

export const handler = async (event: unknown, context: unknown) => {
  if (!cachedHandler) {
    cachedHandler = await buildHandler();
  }
  return cachedHandler(event, context);
};