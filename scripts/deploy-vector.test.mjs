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

  it('deploy.mjs rejects sample-observed backfill gaps before coverage confirmation (R12)', () => {
    const src = fs.readFileSync(path.resolve(WORKER_DIR, 'deploy.mjs'), 'utf-8');
    // R12 review：采样观察到缺少 accountId 元数据的向量（无论 ID 是否带账号前缀）
    // 都是已知回填缺口——覆盖判定必须先处理该缺口，即使完整枚举成功（未发现纯
    // 数字 ID）也不得返回 coverageConfirmed: true（调用方就不会保存 verified: true）。
    assert.match(
      src,
      /if \(legacyCount > 0\) \{[\s\S]{0,800}?acct_verify_coverage_sample_legacy[\s\S]{0,400}?reason: 'legacy_present'[\s\S]*?const enumeration = enumerateVectorIds\(indexName, listVectorIdsPage\);/,
      'sample-observed gap must fail verification before enumeration-based coverage confirmation'
    );
    // 采样缺口失败结果绝不携带 coverageConfirmed: true / ok: true。
    const gapBlock = src.match(/if \(legacyCount > 0\) \{[\s\S]{0,800}?reason: 'legacy_present' \};/);
    assert.ok(gapBlock, 'sample-gap failure block must exist');
    assert.ok(!gapBlock[0].includes('coverageConfirmed: true') && !gapBlock[0].includes('ok: true'),
      'sample-gap failure must not report ok/coverageConfirmed as true');
    // 新告警文案必须中英双语齐备。
    assert.equal(
      src.split('acct_verify_coverage_sample_legacy:').length - 1,
      2,
      'acct_verify_coverage_sample_legacy must exist in both zh and en dictionaries'
    );
  });

  it('vectorize ID enumeration handles the pagination cap and end-of-pages by behavior (R12/R13)', async () => {
    const deploySrc = fs.readFileSync(path.resolve(WORKER_DIR, 'deploy.mjs'), 'utf-8');
    // R13 review：分页读取已抽为可注入参数（cloudflare-worker/enumerate-vector-ids.mjs），
    // 这里用注入的读取器验证实际行为，而不是只断言 deploy.mjs 的源码文本顺序
    // （旧断言在 if (!reachedEnd) 被反转时仍会通过）。
    assert.ok(
      deploySrc.includes("from './enumerate-vector-ids.mjs'"),
      'deploy.mjs must use the shared injectable enumeration module'
    );
    assert.ok(
      deploySrc.includes('enumerateVectorIds(indexName, listVectorIdsPage)'),
      'deploy.mjs must pass its wrangler-backed page reader into the shared enumeration'
    );
    const { enumerateVectorIds } = await import(path.resolve(WORKER_DIR, 'enumerate-vector-ids.mjs'));

    // 最后一个允许读取的页面仍返回游标：枚举不完整，必须返回 ok: false +
    // reason: 'page_limit_exceeded'，且停止在分页上限（不得死循环）。
    let pages = 0;
    const endlessReader = () => {
      pages += 1;
      return { vectors: [{ id: `7:${pages}` }], nextCursor: `cursor-${pages}` };
    };
    const capped = enumerateVectorIds('idx', endlessReader);
    assert.equal(capped.ok, false);
    assert.equal(capped.reason, 'page_limit_exceeded');
    assert.equal(pages, 500, 'enumeration must stop at MAX_ENUM_PAGES');

    // 同一页不返回游标：正常读到末页，返回 ok: true（含 legacy 统计）。
    const drained = enumerateVectorIds('idx', () => ({ vectors: ['7:42', '101'] }));
    assert.equal(drained.ok, true);
    assert.equal(drained.total, 2);
    assert.equal(drained.legacyCount, 1, 'numeric-only ID must be counted as legacy');

    // 读取失败 / 空快照矛盾 / 缺少索引名仍按失败处理。
    assert.deepEqual(enumerateVectorIds('idx', () => null), { ok: false, reason: 'list_failed' });
    assert.deepEqual(enumerateVectorIds('idx', () => ({ vectors: [] })), { ok: false, reason: 'empty_snapshot' });
    assert.deepEqual(enumerateVectorIds('', endlessReader), { ok: false, reason: 'missing_index_name' });
  });

  it('README documents that any numeric-only legacy vector blocks verified enablement (R12 ISSUE-3)', () => {
    const readme = fs.readFileSync(path.resolve(WORKER_DIR, 'README.md'), 'utf-8');
    const deploySrc = fs.readFileSync(path.resolve(WORKER_DIR, 'deploy.mjs'), 'utf-8');
    const enumSrc = fs.readFileSync(path.resolve(WORKER_DIR, 'enumerate-vector-ids.mjs'), 'utf-8');
    // 行为（代码）为准：纯数字 ID 一律判定 legacy_present，覆盖验证失败/回滚。
    // （R13 review：isLegacyVectorId 已随分页枚举抽至 enumerate-vector-ids.mjs。）
    assert.match(enumSrc, /function isLegacyVectorId\(id\) \{\s*\n\s*return \/\^\\d\+\$\/\.test\(id\);/, 'enumeration must treat numeric-only IDs as legacy');
    assert.ok(deploySrc.includes("reason: 'legacy_present'"), 'deploy must fail coverage on legacy IDs');
    // README 必须给出与代码一致的、可执行的运维路径，而不是「保留副本无害」。
    assert.ok(readme.includes('legacy_present'), 'README must name the deploy verification failure reason');
    assert.ok(readme.includes('delete-vectors'), 'README must give the retire/delete command');
    assert.ok(readme.includes('accountMetadataIndexVerified:false'), 'README must document the forced-keep unverified state');
    assert.ok(readme.includes('覆盖未确认'), 'README must state the unverified-mode limitation');
    assert.ok(readme.includes('先退役 legacy 副本'), 'README must state retiring legacy copies is the verified-enablement path');
    assert.ok(!readme.includes('无法核实归属的副本建议保留——冗余副本不会被账号过滤查询召回，不影响正确性'),
      'README must not claim keeping unverifiable legacy copies is harmless without the verification caveat');
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
