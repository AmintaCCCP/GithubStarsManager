/**
 * 统一数据访问门面。
 *
 * 本地开发：走 better-sqlite3，行为与原 server/src/db/connection.ts 一致；
 * Vercel/serverless：当 TURSO_DATABASE_URL 环境变量存在时，走 Turso 远程
 * libSQL（@libsql/client，纯 HTTP，无原生依赖）。
 *
 * 设计目标：route 层只感知统一的 async 接口（all/get/run/exec/batch），
 * 不再直接接触底层驱动；SQL 方言（datetime('now')、INSERT OR REPLACE、
 * ON CONFLICT...excluded、lastInsertRowid）对两端都有效，无需翻译。
 */
import type Database from 'better-sqlite3';
import { createClient, type Client } from '@libsql/client';
import { config } from '../config.js';

type Row = Record<string, unknown>;

interface RunResult {
  /** better-sqlite3 与 libSQL 都返回 lastInsertRowid；统一为 number */
  lastInsertRowid: number;
  rowsAffected: number;
}

interface BatchStatement {
  sql: string;
  args?: unknown[];
}

class DbFacade {
  private local: Database.Database | null = null;
  private remote: Client | null = null;

  private get isTurso(): boolean {
    return !!process.env.TURSO_DATABASE_URL;
  }

  /** 惰性初始化，避免 better-sqlite3 在 Vercel 构建期被加载。 */
  private async getLocal(): Promise<Database.Database> {
    if (this.local) return this.local;
    // 动态 import：Vercel/Turso 模式下不会走到这里，避免加载 native 模块。
    const mod = await import('better-sqlite3');
    const DatabaseCtor = mod.default;
    this.local = new DatabaseCtor(config.dbPath);
    this.local.pragma('journal_mode = WAL');
    this.local.pragma('foreign_keys = ON');
    this.local.pragma('busy_timeout = 5000');
    return this.local;
  }

  private getRemote(): Client {
    if (this.remote) return this.remote;
    const url = process.env.TURSO_DATABASE_URL;
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!url) throw new Error('TURSO_DATABASE_URL is required in Turso mode');
    this.remote = createClient({ url, authToken });
    return this.remote;
  }

  /** SELECT 多行。 */
  async all<T = Row>(sql: string, ...args: unknown[]): Promise<T[]> {
    if (this.isTurso) {
      const r = await this.getRemote().execute({ sql, args: args as never[] });
      return r.rows as T[];
    }
    const db = await this.getLocal();
    const stmt = db.prepare(sql);
    return stmt.all(...args) as T[];
  }

  /** SELECT 单行；未命中返回 undefined。 */
  async get<T = Row>(sql: string, ...args: unknown[]): Promise<T | undefined> {
    if (this.isTurso) {
      const r = await this.getRemote().execute({ sql, args: args as never[] });
      return r.rows[0] as T | undefined;
    }
    const db = await this.getLocal();
    const stmt = db.prepare(sql);
    return stmt.get(...args) as T | undefined;
  }

  /** INSERT/UPDATE/DELETE。返回 lastInsertRowid 供路由回查新建行。 */
  async run(sql: string, ...args: unknown[]): Promise<RunResult> {
    if (this.isTurso) {
      const r = await this.getRemote().execute({ sql, args: args as never[] });
      return {
        lastInsertRowid: r.lastInsertRowid === undefined ? 0 : Number(r.lastInsertRowid),
        rowsAffected: r.rowsAffected ?? 0,
      };
    }
    const db = await this.getLocal();
    const stmt = db.prepare(sql);
    const r = stmt.run(...args);
    return {
      lastInsertRowid: r.lastInsertRowid === undefined ? 0 : Number(r.lastInsertRowid),
      rowsAffected: r.changes,
    };
  }

  /** 执行多段 DDL/无返回语句（schema 初始化用）。 */
  async exec(sql: string): Promise<void> {
    if (this.isTurso) {
      await this.getRemote().executeMultiple(sql);
      return;
    }
    const db = await this.getLocal();
    db.exec(sql);
  }

  /**
   * 事务批处理。替代原 better-sqlite3 的 db.transaction(() => {...})。
   * 远端用 client.batch(stmts, 'write')；本地逐条执行，靠同步语义天然原子。
   */
  async batch(statements: BatchStatement[]): Promise<RunResult[]> {
    if (this.isTurso) {
      const r = await this.getRemote().batch(
        statements.map((s) => ({ sql: s.sql, args: (s.args ?? []) as never[] })),
        'write',
      );
      return r.map((row) => ({
        lastInsertRowid: row.lastInsertRowid === undefined ? 0 : Number(row.lastInsertRowid),
        rowsAffected: row.rowsAffected ?? 0,
      }));
    }
    const db = await this.getLocal();
    const tx = db.transaction(() => {
      const results: RunResult[] = [];
      for (const s of statements) {
        const r = db.prepare(s.sql).run(...(s.args ?? []));
        results.push({
          lastInsertRowid: r.lastInsertRowid === undefined ? 0 : Number(r.lastInsertRowid),
          rowsAffected: r.changes,
        });
      }
      return results;
    });
    return tx();
  }

  /** PRAGMA 查询（如 table_info），两端统一走 SQLite 原生表函数。 */
  async pragma(table: string): Promise<Array<{ name: string }>> {
    if (this.isTurso) {
      // libSQL 是 SQLite 分支，无 information_schema；用原生表函数 pragma_table_info。
      const r = await this.getRemote().execute({
        sql: 'SELECT name FROM pragma_table_info(?)',
        args: [table],
      });
      return r.rows as unknown as Array<{ name: string }>;
    }
    const db = await this.getLocal();
    return db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  }

  /** 关闭连接（优雅停机用，远端无状态）。 */
  close(): void {
    if (this.local) this.local.close();
    this.local = null;
    this.remote = null;
  }
}

export const db = new DbFacade();
