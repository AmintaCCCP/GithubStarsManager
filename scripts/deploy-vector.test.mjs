import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const WORKER_DIR = path.resolve(ROOT_DIR, 'cloudflare-worker');

describe('cloudflare-worker deployment entrypoints and scripts verification', () => {
  it('cloudflare-worker/deploy.mjs exists and responds to --help cleanly in both zh and en', () => {
    const file = path.resolve(WORKER_DIR, 'deploy.mjs');
    assert.ok(fs.existsSync(file), 'cloudflare-worker/deploy.mjs must exist');

    // 测试英文帮助
    const resEn = spawnSync('node', [file, '--help', '--lang=en'], { encoding: 'utf-8' });
    assert.equal(resEn.status, 0);
    assert.ok(resEn.stdout.includes('Vector Search Deploy Wizard'), 'must output english text');
    assert.ok(resEn.stdout.includes('--quick'), 'help output must document --quick');
    assert.ok(resEn.stdout.includes('--lang'), 'help output must document --lang');

    // 测试中文帮助
    const resZh = spawnSync('node', [file, '--help', '--lang=zh'], { encoding: 'utf-8' });
    assert.equal(resZh.status, 0);
    assert.ok(resZh.stdout.includes('向量搜索一键部署向导'), 'must output chinese text');
  });

  it('root directory does not contain deployment shell/bat/ps1 scripts', () => {
    assert.ok(!fs.existsSync(path.resolve(ROOT_DIR, 'deploy-vector.sh')), 'root must not contain deploy-vector.sh');
    assert.ok(!fs.existsSync(path.resolve(ROOT_DIR, 'deploy-vector.bat')), 'root must not contain deploy-vector.bat');
    assert.ok(!fs.existsSync(path.resolve(ROOT_DIR, 'deploy-vector.ps1')), 'root must not contain deploy-vector.ps1');
  });

  it('cloudflare-worker/deploy.sh exists and is executable', () => {
    const file = path.resolve(WORKER_DIR, 'deploy.sh');
    assert.ok(fs.existsSync(file), 'cloudflare-worker/deploy.sh must exist');
    const stats = fs.statSync(file);
    if (process.platform !== 'win32') {
      assert.ok((stats.mode & 0o111) !== 0, 'cloudflare-worker/deploy.sh must have executable permission');
    }
  });

  it('cloudflare-worker/deploy.bat and cloudflare-worker/deploy.ps1 exist for Windows', () => {
    const bat = path.resolve(WORKER_DIR, 'deploy.bat');
    const ps1 = path.resolve(WORKER_DIR, 'deploy.ps1');
    assert.ok(fs.existsSync(bat), 'cloudflare-worker/deploy.bat must exist');
    assert.ok(fs.existsSync(ps1), 'cloudflare-worker/deploy.ps1 must exist');
    const batContent = fs.readFileSync(bat, 'utf-8');
    assert.ok(batContent.includes('deploy.mjs'), 'bat must run deploy.mjs');
    assert.ok(batContent.includes('%CMDCMDLINE%'), 'bat must handle double-click pause');
  });

  it('.gitattributes enforces CRLF line endings for batch files', () => {
    const gitattributes = fs.readFileSync(path.resolve(ROOT_DIR, '.gitattributes'), 'utf-8');
    assert.ok(gitattributes.includes('*.bat text eol=crlf'), 'must enforce CRLF for .bat');
    assert.ok(gitattributes.includes('*.cmd text eol=crlf'), 'must enforce CRLF for .cmd');
  });

  it('package.json has deploy:vector script pointing to cloudflare-worker/deploy.mjs', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(ROOT_DIR, 'package.json'), 'utf-8'));
    assert.equal(pkg.scripts['deploy:vector'], 'node cloudflare-worker/deploy.mjs');
  });

  it('cloudflare-worker/package.json has deploy:interactive and deploy:vector scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(WORKER_DIR, 'package.json'), 'utf-8'));
    assert.equal(pkg.scripts['deploy:interactive'], 'node deploy.mjs');
    assert.equal(pkg.scripts['deploy:vector'], 'node deploy.mjs');
  });

  it('.gitignore ignores cloudflare-worker/.deploy-config.json and temp files', () => {
    const gitignore = fs.readFileSync(path.resolve(ROOT_DIR, '.gitignore'), 'utf-8');
    assert.ok(gitignore.includes('cloudflare-worker/.deploy-config.json'), 'must ignore .deploy-config.json');
    assert.ok(gitignore.includes('cloudflare-worker/.deploy-config.json.*.tmp'), 'must ignore temp config files');
  });

  it('cloudflare-worker/deploy.mjs handles --status error gracefully with i18n when not configured', () => {
    const file = path.resolve(WORKER_DIR, 'deploy.mjs');
    const isolatedEnv = {
      ...process.env,
      DEPLOY_CONFIG_FILE: path.resolve(WORKER_DIR, '.non-existent-deploy-config.json'),
    };
    const res = spawnSync('node', [file, '--status', '--lang=en'], {
      encoding: 'utf-8',
      env: isolatedEnv,
    });
    assert.ok(res.status !== 0);
    assert.ok(res.stderr.includes('No local config found') || res.stdout.includes('No local config found'));

    const resZh = spawnSync('node', [file, '--status', '--lang=zh'], {
      encoding: 'utf-8',
      env: isolatedEnv,
    });
    assert.ok(resZh.status !== 0);
    assert.ok(resZh.stderr.includes('未找到本地配置') || resZh.stdout.includes('未找到本地配置'));
  });

  it('cloudflare-worker/deploy.mjs respects saved.locale from isolated config when valid', () => {
    const file = path.resolve(WORKER_DIR, 'deploy.mjs');
    const tempConfig = path.resolve(WORKER_DIR, '.test-locale-config.json');
    try {
      fs.writeFileSync(tempConfig, JSON.stringify({ locale: 'en' }), 'utf-8');
      const res = spawnSync('node', [file, '--help'], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          DEPLOY_CONFIG_FILE: tempConfig,
          LANG: 'zh_CN.UTF-8',
          LC_ALL: 'zh_CN.UTF-8',
          LC_MESSAGES: 'zh_CN.UTF-8',
        },
      });
      assert.ok(res.stdout.includes('Usage:') || res.stdout.includes('Options:'));
    } finally {
      if (fs.existsSync(tempConfig)) fs.unlinkSync(tempConfig);
    }
  });

  it('deploy.mjs overrides ACCOUNT_METADATA_INDEXED via --var on both enable and rollback deploys', () => {
    // R2 review：deployWorker 必须在 true/false 两个方向都显式传 --var 覆盖，
    // 回滚部署不得继承本地 wrangler.toml 中可能被手动改成的 "true"。
    const src = fs.readFileSync(path.resolve(WORKER_DIR, 'deploy.mjs'), 'utf-8');
    assert.match(
      src,
      /deployArgs = \['deploy', '--var', `ACCOUNT_METADATA_INDEXED:\$\{accountMetadataIndexed \? 'true' : 'false'\}`\]/,
      'deployWorker must build an explicit --var override for both directions'
    );
    assert.ok(!src.includes("['deploy'];"), 'rollback must not deploy without the explicit override');
  });

  it('deploy.mjs keeps --quick non-interactive on verification failure and gates unverified flags', () => {
    const src = fs.readFileSync(path.resolve(WORKER_DIR, 'deploy.mjs'), 'utf-8');
    // --quick 验证失败时按部署模式自动回滚，绝不等待输入。
    assert.ok(
      src.includes('{ interactive: false })'),
      '--quick must call verification with interactive:false'
    );
    // 快速部署只复用「上次验证通过」的启用标记（强制保留 ≠ 已就绪）。
    assert.ok(
      src.includes('savedConfig.accountMetadataIndexVerified === true'),
      'quick deploy must gate reuse of the enable flag on the verified marker'
    );
  });

  it('worker implementations do not call the unavailable Vectorize binding list()', () => {
    // 生产 Vectorize binding 不提供 list()（完整枚举只有 REST API / wrangler CLI），
    // 分页列举分支是不可达代码；清理只能采样并如实标注「未验证」。
    for (const f of ['worker.js', path.join('src', 'index.ts')]) {
      const src = fs.readFileSync(path.resolve(WORKER_DIR, f), 'utf-8');
      assert.ok(!src.includes('.list('), `${f} must not call the unavailable binding list()`);
      assert.ok(src.includes('partial: true, verified: false'), `${f} must keep the honest unverified cleanup response`);
      // 分页分支的「可验证完成」返回（partial: false）必须随分支一并移除。
      assert.ok(!src.includes('listedAll'), `${f} must not keep the dead pagination branch`);
      assert.ok(
        !/\bpartial: false \}\);/.test(src),
        `${f} must never return cleanup as verified-complete`
      );
    }
  });

  it('wrangler.toml keeps ACCOUNT_METADATA_INDEXED default "false"', () => {
    const toml = fs.readFileSync(path.resolve(WORKER_DIR, 'wrangler.toml'), 'utf-8');
    assert.match(toml, /^ACCOUNT_METADATA_INDEXED = "false"$/m, 'deployment default must stay false');
  });
});
