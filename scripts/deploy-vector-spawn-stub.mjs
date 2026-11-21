/**
 * deploy-vector.test.mjs 的命令执行器替身（R15 finding 30）。
 *
 * 通过 `node --import <本文件> cloudflare-worker/deploy.mjs --quick ...` 预加载：
 * 注册模块解析钩子，把后续对 `node:child_process` 的具名导入重定向到本模块，
 * 由本模块记录每次 spawnSync 的实际参数并返回罐头结果——deploy.mjs 的 wrangler
 * 调用由此可被行为级断言（启用部署传 ACCOUNT_METADATA_INDEXED:true、验证失败
 * 后的自动回滚传 false），且测试绝不执行真实的 wrangler deploy。
 *
 * 记录写入 DEPLOY_SPAWN_LOG 指向的文件（每行一条 JSON），供测试进程在子进程
 * 退出后读取。罐头输出刻意不含 workers.dev URL：deploy.mjs 会回退到配置中的
 * workerUrl（指向本机不可达端口），使部署后验证快速失败且不产生外网请求。
 */
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

// 本模块自身的静态导入先于钩子注册求值——这里拿到的始终是真实 builtin。
export * from 'node:child_process';

const stubUrl = pathToFileURL(import.meta.filename).href;
const logFile = process.env.DEPLOY_SPAWN_LOG || '';
const recorded = [];

export function spawnSync(file, args, options) {
  const entry = { file: String(file), args: (Array.isArray(args) ? args : []).map(String) };
  recorded.push(entry);
  if (logFile) {
    try {
      fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`, 'utf-8');
    } catch {
      // 记录失败不改变罐头结果（测试会因日志缺失而失败并暴露问题）。
    }
  }
  if (entry.args.includes('deploy')) {
    return {
      status: 0,
      stdout: 'Total Upload: 1 KiB / Worker uploaded (canned test output, no public url)\n',
      stderr: '',
      pid: -1,
      output: [null, 'canned deploy output', ''],
      signal: null,
    };
  }
  return {
    status: 0,
    stdout: 'canned',
    stderr: '',
    pid: -1,
    output: [null, 'canned', ''],
    signal: null,
  };
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'node:child_process') {
      return { url: stubUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
