import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

describe('deploy-vector entrypoints and scripts verification', () => {
  it('scripts/deploy-vector.mjs exists and responds to --help cleanly in both zh and en', () => {
    const file = path.resolve(ROOT_DIR, 'scripts/deploy-vector.mjs');
    assert.ok(fs.existsSync(file), 'scripts/deploy-vector.mjs must exist');

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

  it('cloudflare-worker/deploy.mjs exists and imports scripts/deploy-vector.mjs', () => {
    const file = path.resolve(ROOT_DIR, 'cloudflare-worker/deploy.mjs');
    assert.ok(fs.existsSync(file), 'cloudflare-worker/deploy.mjs must exist');
    const content = fs.readFileSync(file, 'utf-8');
    assert.ok(content.includes('deploy-vector.mjs'), 'must import deploy-vector.mjs');
  });

  it('deploy-vector.sh exists and is executable', () => {
    const file = path.resolve(ROOT_DIR, 'deploy-vector.sh');
    assert.ok(fs.existsSync(file), 'deploy-vector.sh must exist');
    const stats = fs.statSync(file);
    if (process.platform !== 'win32') {
      assert.ok((stats.mode & 0o111) !== 0, 'deploy-vector.sh must have executable permission');
    }
  });

  it('deploy-vector.bat and deploy-vector.ps1 exist for Windows', () => {
    const bat = path.resolve(ROOT_DIR, 'deploy-vector.bat');
    const ps1 = path.resolve(ROOT_DIR, 'deploy-vector.ps1');
    assert.ok(fs.existsSync(bat), 'deploy-vector.bat must exist');
    assert.ok(fs.existsSync(ps1), 'deploy-vector.ps1 must exist');
    const batContent = fs.readFileSync(bat, 'utf-8');
    assert.ok(batContent.includes('deploy-vector.mjs'), 'bat must run deploy-vector.mjs');
  });

  it('package.json has deploy:vector script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(ROOT_DIR, 'package.json'), 'utf-8'));
    assert.equal(pkg.scripts['deploy:vector'], 'node scripts/deploy-vector.mjs');
  });

  it('cloudflare-worker/package.json has deploy:interactive script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(ROOT_DIR, 'cloudflare-worker/package.json'), 'utf-8'));
    assert.equal(pkg.scripts['deploy:interactive'], 'node deploy.mjs');
  });

  it('.gitignore ignores cloudflare-worker/.deploy-config.json', () => {
    const gitignore = fs.readFileSync(path.resolve(ROOT_DIR, '.gitignore'), 'utf-8');
    assert.ok(gitignore.includes('cloudflare-worker/.deploy-config.json'), 'must ignore .deploy-config.json');
  });

  it('scripts/deploy-vector.mjs handles --status error gracefully with i18n when not configured', () => {
    const file = path.resolve(ROOT_DIR, 'scripts/deploy-vector.mjs');
    const isolatedEnv = {
      ...process.env,
      DEPLOY_CONFIG_FILE: path.resolve(ROOT_DIR, 'cloudflare-worker', '.non-existent-deploy-config.json'),
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

  it('scripts/deploy-vector.mjs respects saved.locale from isolated config when valid', () => {
    const file = path.resolve(ROOT_DIR, 'scripts/deploy-vector.mjs');
    const tempConfig = path.resolve(ROOT_DIR, 'cloudflare-worker', '.test-locale-config.json');
    try {
      fs.writeFileSync(tempConfig, JSON.stringify({ locale: 'en' }), 'utf-8');
      const res = spawnSync('node', [file, '--help'], {
        encoding: 'utf-8',
        env: {
          ...process.env,
          DEPLOY_CONFIG_FILE: tempConfig,
          LANG: 'zh_CN.UTF-8',
        },
      });
      assert.ok(res.stdout.includes('Usage:') || res.stdout.includes('Options:'));
    } finally {
      if (fs.existsSync(tempConfig)) fs.unlinkSync(tempConfig);
    }
  });
});
