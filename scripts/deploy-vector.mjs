#!/usr/bin/env node
/**
 * scripts/deploy-vector.mjs
 * 
 * GitHub Stars Manager — 向量搜索 Cloudflare Worker & Vectorize 一键部署向导 (TUI)
 * 适配全平台 (macOS / Linux / Windows)，零第三方依赖，纯 Node.js 原生运行。
 * 支持完整双语 (中文 / English)，自动识别并保护历史老用户已有部署。
 * 针对未安装 Wrangler、未登录 Cloudflare 等场景提供全自动自愈与友好闭环引导。
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 根目录与 worker 目录路径
const ROOT_DIR = path.resolve(__dirname, '..');
const WORKER_DIR = path.resolve(ROOT_DIR, 'cloudflare-worker');
const CONFIG_FILE = process.env.DEPLOY_CONFIG_FILE || path.resolve(WORKER_DIR, '.deploy-config.json');
const WRANGLER_TOML = path.resolve(WORKER_DIR, 'wrangler.toml');

// ======================== 多语言 i18n 系统 ========================
let currentLocale = detectInitialLocale();

function detectInitialLocale() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--lang=')) {
      const l = arg.slice(7).toLowerCase();
      if (l.startsWith('zh')) return 'zh';
      if (l.startsWith('en')) return 'en';
    }
  }

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      if (saved.locale === 'zh' || saved.locale === 'en') return saved.locale;
    }
  } catch {}

  const envLang = (process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || process.env.LANGUAGE || '').toLowerCase();
  if (envLang.startsWith('zh')) return 'zh';

  try {
    const sysLocale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    if (sysLocale.startsWith('zh')) return 'zh';
  } catch {}

  return 'en';
}

const MESSAGES = {
  zh: {
    banner_title: 'GitHub Stars Manager — 向量搜索一键部署向导 (TUI)',
    banner_subtitle: '自动化部署 Cloudflare Worker & Vectorize 向量索引服务',
    help_desc: 'GitHub Stars Manager — 向量搜索一键部署向导',
    help_usage: '用法:',
    help_options: '选项:',
    help_opt_help: '显示帮助信息并退出',
    help_opt_quick: '若已有本地配置，直接执行快速部署 (无交互)',
    help_opt_status: '仅测试现有配置的 Worker 连通性',
    help_opt_lang: '指定界面语言 (zh 或 en)',
    sigint_exit: '👋 部署操作已被用户中断，安全退出。',
    node_version_low: '❌ Node.js 版本过低 (当前: v{version})，请升级到 Node.js 18 或更高版本。',
    installing_deps: '📦 正在自动准备部署依赖环境 (wrangler CLI)...',
    install_deps_failed: '❌ 依赖项安装失败，请检查网络连接。',
    install_deps_success: '✅ 依赖环境准备就绪！',
    deps_retry_prompt: '是否尝试切换为国内 npm 镜像源 (npmmirror) 并重试安装？',
    step_1_title: 'Cloudflare 身份认证',
    step_2_title: 'Vectorize 向量索引配置',
    step_3_title: '配置访问密钥 (AUTH_TOKEN)',
    step_4_title: '执行部署与验证',
    cf_card_title: '💡 什么是 Cloudflare 认证？为什么不用打开网页后台？',
    cf_card_lines: [
      '• 向量搜索使用 Cloudflare Vectorize 向量数据库和轻量 Worker 代理服务。',
      '• 只需要一次授权，本脚本将全自动在终端完成所有创建和绑定工作。',
      '• 你完全不需要去打开 Cloudflare 网页后台去手动找菜单、建索引或配路由！',
      '• 官方免费账号已包含每月 500 万次免费向量查询，完全足够个人 Star 管理使用。',
    ],
    cf_detected: '✅ 已检测到 Cloudflare 登录身份：{account}',
    cf_no_repeat: '   无需重复登录，可直接继续部署。',
    cf_not_logged_in: '⚠️ 当前环境未检测到有效 Cloudflare 登录。',
    cf_auth_method: '请选择 Cloudflare 授权方式',
    cf_opt_oauth: '一键浏览器授权 (推荐)',
    cf_opt_oauth_hint: '自动打开浏览器点击一次 Authorize 即可，零手动配置',
    cf_opt_token: '使用 Cloudflare API Token',
    cf_opt_token_hint: '适合无浏览器环境或已有 API Token 的用户',
    cf_opt_signup: '还没有 Cloudflare 账号？(免费注册)',
    cf_opt_signup_hint: '自动在浏览器打开注册页面，注册完成无需信用卡',
    cf_signup_opening: '🌐 正在打开 Cloudflare 免费注册页面: https://dash.cloudflare.com/sign-up',
    cf_signup_guide_title: '🌐 Cloudflare 免费账号注册指引',
    cf_signup_guide_lines: [
      '已在你的浏览器中打开注册页面: https://dash.cloudflare.com/sign-up',
      '1. 填写邮箱和密码完成注册（完全免费，无需绑定信用卡）',
      '2. 查收验证邮件并点击激活',
      '3. 完成后返回此终端，按回车键即可开始一键授权登录！',
    ],
    cf_signup_done_prompt: '注册并激活完成后，按回车键开始授权登录...',
    cf_launching_oauth: '🚀 正在启动 Wrangler 一键授权，浏览器将自动弹出...',
    cf_headless_hint: '（如果在无图形界面服务器上运行，请取消并选择使用 API Token）',
    cf_login_success: '✅ Cloudflare 授权登录成功！账号：{account}',
    cf_login_failed: '❌ 未能检测到有效登录状态。',
    cf_retry_login_prompt: '是否重新尝试授权登录？',
    cf_token_guide_title: '📌 如何获取 Cloudflare API Token？',
    cf_token_guide_lines: [
      '1. 打开 https://dash.cloudflare.com/profile/api-tokens',
      '2. 点击 "Create Token" -> 选择 "Edit Cloudflare Workers" 模板',
      '3. 确认权限包含: Workers Scripts(Edit), Vectorize(Edit), Account Settings(Read)',
      '4. 点击创建并复制生成的 Token 字符串。',
    ],
    cf_token_prompt: '请输入你的 Cloudflare API Token',
    cf_token_empty: '❌ API Token 不能为空。',
    cf_token_success: '✅ API Token 验证成功！账号：{account}',
    cf_token_warn: '⚠️ Token 临时设置完成，后续命令将尝试使用该 Token 部署。',
    vec_card_title: '💡 什么是 Vectorize 向量索引？',
    vec_card_lines: [
      '• Vectorize 是 Cloudflare 提供的全球边缘向量数据库，用于毫秒级语义搜索。',
      '• 本次更新不会改变已有索引版本，若云端已有索引，将自动复用！',
      '• 索引的“维度 (Dimensions)”必须与客户端 App 中选取的 Embedding 模型完全匹配。',
    ],
    vec_index_prompt: '请输入 Vectorize 索引名称',
    vec_checking_remote: '🔍 正在检查远端是否存在索引 "{name}"...',
    vec_remote_found: '✅ 检测到远端已存在向量索引 "{name}"！',
    vec_dim_info: '   - 当前维度: {dim} 维 | 度量算法: {metric}',
    vec_preserve_note: '⚡ 严格保留现有索引与所有向量数据，不执行重建，无需重新索引！',
    vec_not_found_create: 'ℹ️ 远端未找到名为 "{name}" 的索引，将为你创建新索引。',
    vec_model_select_prompt: '请选择你计划在客户端使用的 Embedding 模型',
    vec_custom_dim_prompt: '请输入向量维度 (正整数，例如 1536, 768, 1024)',
    vec_custom_dim_invalid: '⚠️ 请输入合法的正整数维度。',
    vec_creating_index: '🛠 正在创建 Cloudflare Vectorize 索引 "{name}" (维度: {dim}, metric: {metric})...',
    vec_create_failed: '❌ 创建 Vectorize 索引失败:',
    vec_create_success: '✅ 向量索引 "{name}" 创建成功！',
    token_card_title: '💡 什么是 AUTH_TOKEN？为什么需要它？',
    token_card_lines: [
      '• AUTH_TOKEN 是保护你 Worker 的安全访问凭据。',
      '• 只有拥有此 Token 的 GitHub Stars Manager 客户端才能调用你的 Worker。',
      '• 可以防止他人未经授权调用你的 Worker，避免消耗你的免费配额。',
      '• 本脚本会自动保存 Token 到本地，后续部署自动沿用，不需要反复记录。',
    ],
    token_detected_saved: 'ℹ️ 检测到本地已保存历史部署密钥：{token}',
    token_keep_prompt: '是否继续使用已有的 AUTH_TOKEN？',
    token_method_prompt: '请选择 AUTH_TOKEN 设置方式',
    token_opt_auto: '一键自动生成高强度安全密钥 (推荐)',
    token_opt_auto_hint: '自动生成 64 位加密随机串: {preview}...',
    token_opt_custom: '手动输入自定义密钥',
    token_opt_custom_hint: '输入你自己设定的密码字符串',
    token_input_custom: '请输入自定义 AUTH_TOKEN (建议至少 16 位)',
    token_length_warn: '⚠️ 为了安全，AUTH_TOKEN 长度请不少于 8 位。',
    token_set_success: '✅ AUTH_TOKEN 设定成功！[{preview}...]',
    setting_secret: '🔐 正在设置 Worker 安全密钥 (AUTH_TOKEN)...',
    secret_set_success: '✅ AUTH_TOKEN 密钥已安全注入 Cloudflare Worker！',
    deploying_worker: '🚀 正在编译并部署 Cloudflare Worker...',
    deploy_failed: '❌ Worker 部署失败:',
    deploy_success: '✅ Worker 部署成功！',
    testing_worker: '🔍 正在验证 Worker 连通性 ({url}/status)...',
    test_success: '🎉 连通性测试通过！Worker 响应正常。',
    test_info: '   - 当前已存向量数量: {count} 条 | 远端向量维度: {dim} 维',
    test_warn_status: '⚠️ Worker 返回了非 200 状态码: {status} {statusText}',
    test_warn_err: '⚠️ 自动连通性检测遇到提示: {err}',
    test_warn_dns: '   (初次部署 Cloudflare DNS 全球生效通常需要几秒到一分钟，请稍后在 App 设置中重试)',
    local_record_title: '✨ 检测到本地已有部署记录',
    local_record_url: '• Worker 地址:   {url}',
    local_record_index: '• 向量索引名称: {index} ({dim} 维)',
    local_record_token: '• AUTH_TOKEN:    {token}... (已安全保存)',
    local_record_time: '• 上次部署时间: {time}',
    mode_select_prompt: '请选择要执行的操作',
    mode_opt_quick: '⚡ 快速重新部署 (推荐)',
    mode_opt_quick_hint: '代码更新后一键重新部署，保留现有全部配置与索引数据',
    mode_opt_full: '🛠 完整部署向导',
    mode_opt_full_hint: '重新确认或修改各配置项',
    mode_opt_test: '🔍 测试现有 Worker 连通性',
    mode_opt_test_hint: '测试当前已保存的 URL 和 Token 是否有效',
    mode_opt_lang: '🌐 切换语言 / Switch Language',
    mode_opt_lang_hint: 'Switch to English / 切换为中文',
    mode_opt_exit: '🚪 退出',
    op_cancelled: '已取消操作。',
    quick_start: '🚀 开始快速部署流程（保持现有索引与 Token 不变）...',
    remote_found_title: '🎉 检测到云端已有部署！(已自动发现现有配置)',
    remote_claim_desc: [
      '系统检测到你的 Cloudflare 账号中已存在历史部署，为了保护你的现有数据与服务：',
      '• 严格保留现有向量索引与所有数据，绝不重置或升级索引版本！',
      '• 云端已配置的 AUTH_TOKEN 密钥将完整保留，不强制重置。',
      '• 本向导将自动为你生成本地配置文件，以便后续一键更新。',
    ],
    remote_opt_claim_deploy: '⚡ 认领并一键快速更新部署 (推荐 - 立即更新 Worker 并保护老数据)',
    remote_opt_claim_deploy_hint: '自动同步配置至本地并部署最新 Worker 代码',
    remote_opt_claim_only: '📥 仅认领并生成本地配置文件 (不执行部署)',
    remote_opt_claim_only_hint: '仅将云端已发现的参数保存到本地 .deploy-config.json',
    remote_opt_reconfigure: '🛠 重新配置参数',
    remote_opt_reconfigure_hint: '覆盖并重新指定部署参数',
    remote_token_claim_prompt: '由于 Cloudflare 安全限制，云端密钥不可反向明文读取。如果你在 App 设置页记录了该 Token，建议输入保存；若留空，脚本将完整保留云端已有密钥：',
    remote_claimed_saved: '✅ 已成功认领云端部署并生成本地配置: {file}',
    final_success_title: '🎉 向量搜索部署圆满成功！',
    final_card_title: '📋 请将以下参数复制填入 GitHub Stars Manager 设置中：',
    final_card_settings_path: '【设置 → 向量语义搜索 → ② Cloudflare Vectorize 连接】',
    final_card_url: '1. Worker 地址 (URL):',
    final_card_token: '2. 认证 Token (AUTH_TOKEN):',
    final_card_token_keep: '   (已保留云端原有的密钥，请在客户端中使用你此前设置的 Token)',
    final_card_dim: '📐 对应的索引维度: {dim} 维 (请确保客户端的 Embedding 模型维度与之一致)',
    final_card_saved_tip: '💡 所有配置已自动保存在本地: cloudflare-worker/.deploy-config.json',
    final_card_next_tip: '   下次更新只需运行快速部署，无需重复输入任何参数！',
    final_next_step: '👉 接下来在 App 中点击 "测试 Worker 连接"，看到成功后即可开始向量搜索索引！',
    prompt_enter_number: '请输入序号 (1-{max})',
    prompt_invalid_number: '⚠️ 请输入有效序号 (1-{max})',
    prompt_yn_invalid: '⚠️ 请输入 y 或 n',
    worker_url_prompt: '请输入你的 Worker URL (例如: https://github-stars-vectorize.xxx.workers.dev)',
    worker_url_missing: 'ℹ️ 未能从输出中自动提取 Worker URL。',
  },
  en: {
    banner_title: 'GitHub Stars Manager — Vector Search One-Click Deploy Wizard (TUI)',
    banner_subtitle: 'Automated Deployment for Cloudflare Worker & Vectorize Service',
    help_desc: 'GitHub Stars Manager — Vector Search Deploy Wizard',
    help_usage: 'Usage:',
    help_options: 'Options:',
    help_opt_help: 'Show help and exit',
    help_opt_quick: 'Run quick redeploy if local config exists (non-interactive)',
    help_opt_status: 'Test connectivity of current configured Worker',
    help_opt_lang: 'Specify language (en or zh)',
    sigint_exit: '👋 Deployment interrupted by user, exiting safely.',
    node_version_low: '❌ Node.js version too low (current: v{version}), please upgrade to Node.js 18 or higher.',
    installing_deps: '📦 Automatically preparing deployment environment (wrangler CLI)...',
    install_deps_failed: '❌ Dependency installation failed. Please check network connection.',
    install_deps_success: '✅ Deployment environment ready!',
    deps_retry_prompt: 'Attempt using npm mirror (npmmirror) and retry?',
    step_1_title: 'Cloudflare Authentication',
    step_2_title: 'Vectorize Index Configuration',
    step_3_title: 'Configure Security Secret (AUTH_TOKEN)',
    step_4_title: 'Deploy & Connectivity Verification',
    cf_card_title: '💡 What is Cloudflare Auth? Why no dashboard needed?',
    cf_card_lines: [
      '• Vector search utilizes Cloudflare Vectorize database & a lightweight Worker.',
      '• With one-time authorization, this script handles all setup directly in terminal.',
      '• You NEVER need to open the Cloudflare web dashboard to configure bindings!',
      '• Free tier accounts include 5M free vector queries/month, plenty for personal Stars.',
    ],
    cf_detected: '✅ Cloudflare authenticated identity: {account}',
    cf_no_repeat: '   No login required, proceeding to deployment.',
    cf_not_logged_in: '⚠️ No active Cloudflare login detected in current environment.',
    cf_auth_method: 'Select Cloudflare authorization method',
    cf_opt_oauth: 'One-click Browser OAuth (Recommended)',
    cf_opt_oauth_hint: 'Opens browser to click Authorize once, zero manual config',
    cf_opt_token: 'Use Cloudflare API Token',
    cf_opt_token_hint: 'Ideal for headless servers or users with an existing token',
    cf_opt_signup: "Don't have a Cloudflare account yet? (Free Sign-up)",
    cf_opt_signup_hint: 'Opens signup page in browser, free & no credit card required',
    cf_signup_opening: '🌐 Opening Cloudflare free sign-up page: https://dash.cloudflare.com/sign-up',
    cf_signup_guide_title: '🌐 Cloudflare Free Account Sign-up Guide',
    cf_signup_guide_lines: [
      'Opened sign-up page in your browser: https://dash.cloudflare.com/sign-up',
      '1. Enter email & password to sign up (free, no credit card required)',
      '2. Verify your email address via activation link',
      '3. Return to this terminal and press Enter to start authorization!',
    ],
    cf_signup_done_prompt: 'After signing up & activating, press Enter to authorize...',
    cf_launching_oauth: '🚀 Launching Wrangler OAuth login, browser will open shortly...',
    cf_headless_hint: '(If running on a headless server, cancel and choose API Token instead)',
    cf_login_success: '✅ Cloudflare OAuth login successful! Account: {account}',
    cf_login_failed: '❌ Active login state not detected.',
    cf_retry_login_prompt: 'Retry authorization login?',
    cf_token_guide_title: '📌 How to get a Cloudflare API Token?',
    cf_token_guide_lines: [
      '1. Open https://dash.cloudflare.com/profile/api-tokens',
      '2. Click "Create Token" -> Select "Edit Cloudflare Workers" template',
      '3. Verify permissions: Workers Scripts(Edit), Vectorize(Edit), Account Settings(Read)',
      '4. Click Create and copy the generated token string.',
    ],
    cf_token_prompt: 'Enter your Cloudflare API Token',
    cf_token_empty: '❌ API Token cannot be empty.',
    cf_token_success: '✅ API Token verified! Account: {account}',
    cf_token_warn: '⚠️ Temporary token configured. Following commands will attempt using it.',
    vec_card_title: '💡 What is a Vectorize index?',
    vec_card_lines: [
      '• Vectorize is Cloudflare edge vector database for millisecond semantic search.',
      '• This update does NOT alter index version; existing indexes are automatically preserved!',
      '• Index Dimensions must strictly match the Embedding model chosen in your client App.',
    ],
    vec_index_prompt: 'Enter Vectorize index name',
    vec_checking_remote: '🔍 Checking if remote index "{name}" exists...',
    vec_remote_found: '✅ Existing remote Vectorize index "{name}" found!',
    vec_dim_info: '   - Dimensions: {dim} | Metric: {metric}',
    vec_preserve_note: '⚡ Strictly preserving existing index & vectors. No recreation required!',
    vec_not_found_create: 'ℹ️ No index named "{name}" found remotely. Creating new index.',
    vec_model_select_prompt: 'Select the Embedding model you plan to use in client App',
    vec_custom_dim_prompt: 'Enter vector dimensions (positive integer, e.g. 1536, 768, 1024)',
    vec_custom_dim_invalid: '⚠️ Please enter a valid positive integer.',
    vec_creating_index: '🛠 Creating Cloudflare Vectorize index "{name}" (dim: {dim}, metric: {metric})...',
    vec_create_failed: '❌ Failed to create Vectorize index:',
    vec_create_success: '✅ Vectorize index "{name}" created successfully!',
    token_card_title: '💡 What is AUTH_TOKEN? Why is it required?',
    token_card_lines: [
      '• AUTH_TOKEN is the security credential protecting your Worker proxy.',
      '• Only GitHub Stars Manager clients carrying this token can invoke your Worker.',
      '• Prevents unauthorized usage and protects your free monthly quota.',
      '• Automatically saved locally for seamless future redeployments.',
    ],
    token_detected_saved: 'ℹ️ Saved deployment secret found locally: {token}',
    token_keep_prompt: 'Keep using the existing AUTH_TOKEN?',
    token_method_prompt: 'Select AUTH_TOKEN configuration method',
    token_opt_auto: 'Auto-generate high-security token (Recommended)',
    token_opt_auto_hint: 'Generates 64-character crypto random string: {preview}...',
    token_opt_custom: 'Enter custom token manually',
    token_opt_custom_hint: 'Type your own custom security string',
    token_input_custom: 'Enter custom AUTH_TOKEN (at least 16 characters recommended)',
    token_length_warn: '⚠️ For security, AUTH_TOKEN must be at least 8 characters long.',
    token_set_success: '✅ AUTH_TOKEN configured! [{preview}...]',
    setting_secret: '🔐 Setting Worker security secret (AUTH_TOKEN)...',
    secret_set_success: '✅ AUTH_TOKEN secret securely injected into Cloudflare Worker!',
    deploying_worker: '🚀 Compiling & deploying Cloudflare Worker...',
    deploy_failed: '❌ Worker deployment failed:',
    deploy_success: '✅ Worker deployed successfully!',
    testing_worker: '🔍 Verifying Worker connectivity ({url}/status)...',
    test_success: '🎉 Connectivity verified! Worker responded normally.',
    test_info: '   - Indexed vectors: {count} | Remote dimensions: {dim}',
    test_warn_status: '⚠️ Worker returned non-200 status code: {status} {statusText}',
    test_warn_err: '⚠️ Connectivity check notice: {err}',
    test_warn_dns: '   (Initial Cloudflare DNS propagation may take a few moments. You can retry later in App)',
    local_record_title: '✨ Local Deployment Record Found',
    local_record_url: '• Worker URL:     {url}',
    local_record_index: '• Vector Index:   {index} ({dim} dims)',
    local_record_token: '• AUTH_TOKEN:     {token}... (Securely saved)',
    local_record_time: '• Last Deployed:  {time}',
    mode_select_prompt: 'Select an action',
    mode_opt_quick: '⚡ Quick Redeploy (Recommended)',
    mode_opt_quick_hint: 'Redeploy updated code in seconds, keeping existing config & index data',
    mode_opt_full: '🛠 Full Deployment Wizard',
    mode_opt_full_hint: 'Review or reconfigure individual deployment settings',
    mode_opt_test: '🔍 Test Worker Connectivity',
    mode_opt_test_hint: 'Verify whether current URL & Token are responding',
    mode_opt_lang: '🌐 Switch Language / 切换语言',
    mode_opt_lang_hint: '切换为中文 / Switch to English',
    mode_opt_exit: '🚪 Exit',
    op_cancelled: 'Operation cancelled.',
    quick_start: '🚀 Starting quick redeployment (preserving index & secret)...',
    remote_found_title: '🎉 Existing Cloudflare Deployment Detected!',
    remote_claim_desc: [
      'Found existing vector deployment on your Cloudflare account. To protect your service & data:',
      '• Existing Vectorize index & all vector data will NEVER be overwritten or reset!',
      '• Existing remote AUTH_TOKEN secret will be safely preserved without forced override.',
      '• This wizard will create a local configuration file for seamless one-click updates.',
    ],
    remote_opt_claim_deploy: '⚡ Claim & Quick Redeploy (Recommended - updates code & preserves data)',
    remote_opt_claim_deploy_hint: 'Syncs remote config locally and deploys latest Worker code',
    remote_opt_claim_only: '📥 Claim & Save Local Config Only (no deploy)',
    remote_opt_claim_only_hint: 'Saves discovered settings to local .deploy-config.json without redeploying',
    remote_opt_reconfigure: '🛠 Reconfigure from scratch',
    remote_opt_reconfigure_hint: 'Overwrite and re-specify all deployment parameters',
    remote_token_claim_prompt: 'Cloudflare does not return secret values in plain text. If you know your original token from App settings, enter it here (or press Enter to keep remote secret untouched):',
    remote_claimed_saved: '✅ Successfully claimed remote deployment and saved config: {file}',
    final_success_title: '🎉 Vector Search Deployed Successfully!',
    final_card_title: '📋 Please copy these values into GitHub Stars Manager settings:',
    final_card_settings_path: '[Settings -> Vector Semantic Search -> ② Cloudflare Vectorize Connection]',
    final_card_url: '1. Worker Address (URL):',
    final_card_token: '2. Auth Token (AUTH_TOKEN):',
    final_card_token_keep: '   (Existing remote secret preserved. Please use your previously configured Token in client)',
    final_card_dim: '📐 Matching Dimensions: {dim} (Ensure client Embedding model matches)',
    final_card_saved_tip: '💡 Configuration saved locally: cloudflare-worker/.deploy-config.json',
    final_card_next_tip: '   Next time, simply run quick redeploy without re-entering parameters!',
    final_next_step: '👉 Now click "Test Worker Connection" in your App, and start indexing once connected!',
    prompt_enter_number: 'Enter choice (1-{max})',
    prompt_invalid_number: '⚠️ Please enter a valid number (1-{max})',
    prompt_yn_invalid: '⚠️ Please enter y or n',
    worker_url_prompt: 'Enter your Worker URL (e.g. https://github-stars-vectorize.xxx.workers.dev)',
    worker_url_missing: 'ℹ️ Unable to automatically extract Worker URL from output.',
  },
};

function t(key, params = {}) {
  const dict = MESSAGES[currentLocale] || MESSAGES.en;
  let text = dict[key] || MESSAGES.en[key] || key;
  if (typeof text === 'string') {
    for (const [k, v] of Object.entries(params)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}

// ======================== ANSI 颜色与样式 ========================
const hasColor = !process.env.NO_COLOR && (process.stdout.isTTY ?? false);

const c = {
  reset: (s) => (hasColor ? `\x1b[0m${s}\x1b[0m` : s),
  bold: (s) => (hasColor ? `\x1b[1m${s}\x1b[22m` : s),
  dim: (s) => (hasColor ? `\x1b[2m${s}\x1b[22m` : s),
  underline: (s) => (hasColor ? `\x1b[4m${s}\x1b[24m` : s),
  cyan: (s) => (hasColor ? `\x1b[36m${s}\x1b[39m` : s),
  green: (s) => (hasColor ? `\x1b[32m${s}\x1b[39m` : s),
  yellow: (s) => (hasColor ? `\x1b[33m${s}\x1b[39m` : s),
  red: (s) => (hasColor ? `\x1b[31m${s}\x1b[39m` : s),
  magenta: (s) => (hasColor ? `\x1b[35m${s}\x1b[39m` : s),
  blue: (s) => (hasColor ? `\x1b[34m${s}\x1b[39m` : s),
  gray: (s) => (hasColor ? `\x1b[90m${s}\x1b[39m` : s),
  bgBlue: (s) => (hasColor ? `\x1b[44m\x1b[37m${s}\x1b[0m` : s),
  bgCyan: (s) => (hasColor ? `\x1b[46m\x1b[30m${s}\x1b[0m` : s),
  bgGreen: (s) => (hasColor ? `\x1b[42m\x1b[30m${s}\x1b[0m` : s),
};

function stripAnsi(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

function extractJson(str) {
  if (!str) return null;
  const cleaned = stripAnsi(str);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1));
    } catch {}
  }
  const arrStart = cleaned.indexOf('[');
  const arrEnd = cleaned.lastIndexOf(']');
  if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
    try {
      return JSON.parse(cleaned.slice(arrStart, arrEnd + 1));
    } catch {}
  }
  return null;
}

function banner() {
  if (process.stdout.isTTY) {
    console.clear();
  }
  const title = t('banner_title');
  const subtitle = t('banner_subtitle');
  console.log(c.cyan('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓'));
  console.log(c.cyan('┃') + c.bold(`  ${title.padEnd(70).slice(0, 70)}`) + c.cyan('┃'));
  console.log(c.cyan('┃') + c.gray(`  ${subtitle.padEnd(70).slice(0, 70)}`) + c.cyan('┃'));
  console.log(c.cyan('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛'));
  console.log('');
}

function printCard(title, lines, borderColor = 'cyan') {
  const colorFn = c[borderColor] || c.cyan;
  const maxWidth = 74;
  console.log(colorFn(`┌─ ${c.bold(title)} ${'─'.repeat(Math.max(2, maxWidth - title.length - 4))}┐`));
  for (const line of lines) {
    console.log(colorFn('│') + `  ${line}`);
  }
  console.log(colorFn(`└${'─'.repeat(maxWidth)}┘`));
  console.log('');
}

function printStep(step, total, title) {
  console.log('');
  console.log(c.bgCyan(c.bold(` [${step}/${total}] `)) + ' ' + c.bold(c.cyan(title)));
  console.log(c.gray('─'.repeat(64)));
}

// 优雅响应 Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n' + c.yellow(t('sigint_exit')));
  process.exit(0);
});

// ======================== 交互式输入组件 ========================
function createRl() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function askQuestion(promptText, defaultValue = '') {
  const rl = createRl();
  return new Promise((resolve) => {
    let resolved = false;
    const defLabel = currentLocale === 'zh' ? '默认' : 'Default';
    const formattedPrompt = defaultValue
      ? `${c.bold('?')} ${promptText} ${c.gray(`[${defLabel}: ${defaultValue}]`)}: `
      : `${c.bold('?')} ${promptText}: `;
    rl.question(formattedPrompt, (answer) => {
      if (!resolved) {
        resolved = true;
        rl.close();
        const val = answer.trim();
        resolve(val || defaultValue);
      }
    });
    rl.on('close', () => {
      if (!resolved) {
        resolved = true;
        resolve(defaultValue);
      }
    });
  });
}

async function askSelect(promptText, options, defaultIndex = 0) {
  console.log(`${c.bold('?')} ${c.bold(promptText)}:`);
  options.forEach((opt, idx) => {
    const isDefault = idx === defaultIndex;
    const num = `  [${idx + 1}]`;
    const label = isDefault ? c.green(c.bold(opt.label)) : opt.label;
    const hint = opt.hint ? c.gray(` (${opt.hint})`) : '';
    const defTag = isDefault ? c.yellow(currentLocale === 'zh' ? ' [推荐/默认]' : ' [Default]') : '';
    console.log(`${c.cyan(num)} ${label}${hint}${defTag}`);
  });

  while (true) {
    const answer = await askQuestion(
      t('prompt_enter_number', { max: options.length }),
      String(defaultIndex + 1)
    );
    const chosen = parseInt(answer, 10);
    if (!isNaN(chosen) && chosen >= 1 && chosen <= options.length) {
      return options[chosen - 1];
    }
    console.log(c.red(`  ${t('prompt_invalid_number', { max: options.length })}`));
  }
}

async function askConfirm(promptText, defaultYes = true) {
  const def = defaultYes ? 'Y/n' : 'y/N';
  while (true) {
    const ans = (await askQuestion(`${promptText} (${def})`, defaultYes ? 'Y' : 'N')).trim().toLowerCase();
    if (ans === 'y' || ans === 'yes') return true;
    if (ans === 'n' || ans === 'no') return false;
    console.log(c.red(`  ${t('prompt_yn_invalid')}`));
  }
}

function openBrowserUrl(url) {
  try {
    const isWindows = process.platform === 'win32';
    const isMac = process.platform === 'darwin';
    if (isMac) {
      spawnSync('open', [url], { stdio: 'ignore' });
    } else if (isWindows) {
      spawnSync('cmd.exe', ['/c', 'start', '', url], { stdio: 'ignore' });
    } else {
      spawnSync('xdg-open', [url], { stdio: 'ignore' });
    }
    return true;
  } catch {
    return false;
  }
}

// ======================== 本地配置持久化 ========================
function loadLocalConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn(c.yellow(`⚠️ Load local config failed: ${err.message}`));
  }
  return null;
}

function saveLocalConfig(config) {
  try {
    if (!fs.existsSync(WORKER_DIR)) {
      fs.mkdirSync(WORKER_DIR, { recursive: true });
    }
    const toSave = { ...config, locale: currentLocale };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(toSave, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    try {
      if (process.platform !== 'win32') {
        fs.chmodSync(CONFIG_FILE, 0o600);
      }
    } catch {}
    return true;
  } catch (err) {
    console.error(c.red(`❌ Save config failed: ${err.message}`));
    return false;
  }
}

// ======================== Wrangler 执行引擎自适应 ========================
function getLocalWranglerBin() {
  const candidatePaths = [
    path.resolve(WORKER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    path.resolve(ROOT_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return { cmd: process.execPath, argsPrefix: [p], needsShell: false };
    }
  }

  try {
    const workerRequire = createRequire(path.resolve(WORKER_DIR, 'package.json'));
    const resolved = workerRequire.resolve('wrangler/bin/wrangler.js');
    if (fs.existsSync(resolved)) {
      return { cmd: process.execPath, argsPrefix: [resolved], needsShell: false };
    }
  } catch {}

  console.error(c.red(currentLocale === 'zh'
    ? '❌ 未找到本地 Wrangler 依赖。请先在 cloudflare-worker 目录下运行 npm install。'
    : '❌ Local Wrangler binary not found. Please run "npm install" inside cloudflare-worker directory.'));
  throw new Error('Local wrangler binary not found');
}

function runWrangler(args, options = {}) {
  const { cmd, argsPrefix, needsShell } = getLocalWranglerBin();
  const fullArgs = [...argsPrefix, ...args];

  return spawnSync(cmd, fullArgs, {
    cwd: options.cwd || WORKER_DIR,
    stdio: options.stdio || 'pipe',
    encoding: 'utf-8',
    shell: options.shell !== undefined ? options.shell : needsShell,
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      NO_UPDATE_NOTIFIER: 'true',
      ...options.env,
    },
  });
}

function runWranglerWithInput(args, inputStr, options = {}) {
  const { cmd, argsPrefix, needsShell } = getLocalWranglerBin();
  const fullArgs = [...argsPrefix, ...args];

  return spawnSync(cmd, fullArgs, {
    cwd: options.cwd || WORKER_DIR,
    input: inputStr,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
    shell: options.shell !== undefined ? options.shell : needsShell,
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      NO_UPDATE_NOTIFIER: 'true',
      ...options.env,
    },
  });
}

function runWranglerInteractive(args, options = {}) {
  const { cmd, argsPrefix, needsShell } = getLocalWranglerBin();
  const fullArgs = [...argsPrefix, ...args];

  return spawnSync(cmd, fullArgs, {
    cwd: options.cwd || WORKER_DIR,
    stdio: 'inherit',
    shell: options.shell !== undefined ? options.shell : needsShell,
    env: {
      ...process.env,
      WRANGLER_SEND_METRICS: 'false',
      NO_UPDATE_NOTIFIER: 'true',
      ...options.env,
    },
  });
}

function checkNodeEnvironment() {
  const [major] = process.versions.node.split('.').map(Number);
  if (major < 18) {
    console.error(c.red(t('node_version_low', { version: process.versions.node })));
    process.exit(1);
  }
}

async function ensureDependencies() {
  const wranglerJs = path.resolve(WORKER_DIR, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  if (fs.existsSync(wranglerJs)) {
    return;
  }

  console.log(c.yellow(t('installing_deps')));
  const isWindows = process.platform === 'win32';
  const npmCmd = isWindows ? 'npm.cmd' : 'npm';
  
  let res = spawnSync(npmCmd, ['install', '--no-fund', '--no-audit'], {
    cwd: WORKER_DIR,
    stdio: 'inherit',
    shell: isWindows,
  });

  if (res.status !== 0) {
    console.warn(c.yellow('\n⚠️ ' + t('install_deps_failed')));
    const tryMirror = await askConfirm(t('deps_retry_prompt'), true);
    if (tryMirror) {
      console.log(c.cyan('🚀 Switching to npmmirror and retrying...'));
      res = spawnSync(npmCmd, ['install', '--registry=https://registry.npmmirror.com', '--no-fund', '--no-audit'], {
        cwd: WORKER_DIR,
        stdio: 'inherit',
        shell: isWindows,
      });
    }
  }

  if (res.status !== 0 && !fs.existsSync(wranglerJs)) {
    console.error(c.red('\n' + t('install_deps_failed')));
    process.exit(1);
  }

  console.log(c.green(t('install_deps_success') + '\n'));
}

// ======================== Cloudflare 认证检测 ========================
function checkCloudflareAuth() {
  const res = runWrangler(['whoami']);
  if (res.status === 0 && res.stdout) {
    const text = stripAnsi(res.stdout);
    const match = text.match(/You are logged in with an API token, associated with the account ['"]?([^'".\n]+)['"]?/i) ||
                  text.match(/associated with the account ['"]?([^'".\n]+)['"]?/i) ||
                  text.match(/logged in with .*? account ['"]?([^'".\n]+)['"]?/i);
    const accountName = match ? match[1] : (currentLocale === 'zh' ? '已认证 Cloudflare 用户' : 'Authenticated Cloudflare User');
    return { loggedIn: true, accountName, raw: text };
  }
  return { loggedIn: false };
}

async function handleCloudflareAuth() {
  printStep(1, 4, t('step_1_title'));
  printCard(t('cf_card_title'), t('cf_card_lines'));

  while (true) {
    const authStatus = checkCloudflareAuth();
    if (authStatus.loggedIn) {
      console.log(c.green(t('cf_detected', { account: c.bold(authStatus.accountName) })));
      console.log(c.gray(t('cf_no_repeat') + '\n'));
      return true;
    }

    console.log(c.yellow(t('cf_not_logged_in')));
    const choice = await askSelect(
      t('cf_auth_method'),
      [
        {
          label: t('cf_opt_oauth'),
          hint: t('cf_opt_oauth_hint'),
          value: 'oauth',
        },
        {
          label: t('cf_opt_token'),
          hint: t('cf_opt_token_hint'),
          value: 'token',
        },
        {
          label: t('cf_opt_signup'),
          hint: t('cf_opt_signup_hint'),
          value: 'signup',
        },
      ],
      0
    );

    if (choice.value === 'signup') {
      console.log('');
      console.log(c.cyan(t('cf_signup_opening')));
      openBrowserUrl('https://dash.cloudflare.com/sign-up');
      printCard(t('cf_signup_guide_title'), t('cf_signup_guide_lines'), 'cyan');
      await askQuestion(t('cf_signup_done_prompt'), '');
      continue;
    }

    if (choice.value === 'oauth') {
      console.log('');
      console.log(c.cyan(t('cf_launching_oauth')));
      console.log(c.gray(t('cf_headless_hint') + '\n'));

      runWranglerInteractive(['login']);

      const verify = checkCloudflareAuth();
      if (verify.loggedIn) {
        console.log(c.green('\n' + t('cf_login_success', { account: verify.accountName })));
        return true;
      } else {
        console.warn(c.yellow('\n' + t('cf_login_failed')));
        const retry = await askConfirm(t('cf_retry_login_prompt'), true);
        if (!retry) return false;
        continue;
      }
    } else {
      printCard(t('cf_token_guide_title'), t('cf_token_guide_lines'), 'yellow');

      const token = await askQuestion(t('cf_token_prompt'));
      if (!token) {
        console.error(c.red(t('cf_token_empty')));
        continue;
      }
      process.env.CLOUDFLARE_API_TOKEN = token;
      const verify = checkCloudflareAuth();
      if (verify.loggedIn) {
        console.log(c.green('\n' + t('cf_token_success', { account: verify.accountName })));
        return true;
      } else {
        delete process.env.CLOUDFLARE_API_TOKEN;
        console.warn(c.yellow('\n' + t('cf_login_failed')));
        continue;
      }
    }
  }
}

// ======================== Vectorize 索引探测与配置 ========================
const MODEL_PRESETS = [
  {
    name: 'OpenAI text-embedding-3-small',
    dimensions: 1536,
    hint_zh: '推荐！通用多语言，高性价比，效果极佳',
    hint_en: 'Recommended! Multilingual, high cost-efficiency, great quality',
  },
  {
    name: 'Gemini text-embedding-004',
    dimensions: 768,
    hint_zh: 'Google Gemini 官方免费模型，支持多语言',
    hint_en: 'Official Google Gemini free embedding model',
  },
  {
    name: 'Cohere embed-multilingual-v3.0',
    dimensions: 1024,
    hint_zh: '高质量多语言模型，适合多语言混搜',
    hint_en: 'High-quality multilingual embedding model',
  },
  {
    name: 'Ollama nomic-embed-text / Local',
    dimensions: 768,
    hint_zh: '完全本地隐私离线运行',
    hint_en: 'Local & private offline embeddings',
  },
  {
    name: 'SiliconFlow BAAI/bge-large-zh-v1.5',
    dimensions: 1024,
    hint_zh: '国内高速访问，中文与代码效果优秀',
    hint_en: 'Fast Asian routing, great for Chinese & code',
  },
  {
    name: 'OpenAI text-embedding-3-large',
    dimensions: 3072,
    hint_zh: '最高精度大模型',
    hint_en: 'Highest precision large model',
  },
  {
    name: 'Custom Dimensions',
    dimensions: 0,
    hint_zh: '手动指定向量维度数字',
    hint_en: 'Specify custom dimension number manually',
  },
];

function checkExistingVectorizeIndex(indexName) {
  const res = runWrangler(['vectorize', 'get', indexName, '--json']);
  if (res.status === 0 && res.stdout) {
    const data = extractJson(res.stdout);
    if (data) {
      return {
        exists: true,
        dimensions: data.dimensions || (data.config && data.config.dimensions),
        metric: data.metric || (data.config && data.config.metric) || 'cosine',
        raw: data,
      };
    }
    return { exists: true };
  }
  return { exists: false };
}

function checkExistingWorkerSecrets(workerName = 'github-stars-vectorize') {
  const res = runWrangler(['secret', 'list', '--name', workerName]);
  if (res.status === 0 && res.stdout) {
    const data = extractJson(res.stdout);
    if (Array.isArray(data)) {
      const names = data.map((item) => (typeof item === 'string' ? item : item.name));
      return { exists: true, hasAuthToken: names.includes('AUTH_TOKEN'), names };
    }
    const clean = stripAnsi(res.stdout);
    return { exists: true, hasAuthToken: clean.includes('AUTH_TOKEN'), names: [] };
  }
  return { exists: false, hasAuthToken: false, names: [] };
}

function checkExistingWorkerDeployments(workerName = 'github-stars-vectorize') {
  const res = runWrangler(['deployments', 'list', '--name', workerName, '--json']);
  if (res.status === 0 && res.stdout) {
    const data = extractJson(res.stdout);
    if (Array.isArray(data) && data.length > 0) {
      return { deployed: true, count: data.length, latest: data[0] };
    }
    const clean = stripAnsi(res.stdout);
    if (clean.includes('Created on') || clean.includes('Deployment ID')) {
      return { deployed: true, count: 1 };
    }
  }
  return { deployed: false, count: 0 };
}

function probeRemoteDeployment() {
  let defaultIndexName = 'github-stars';
  let defaultWorkerName = 'github-stars-vectorize';
  try {
    if (fs.existsSync(WRANGLER_TOML)) {
      const content = fs.readFileSync(WRANGLER_TOML, 'utf-8');
      const nameMatch = content.match(/name\s*=\s*["']([^"']+)["']/);
      if (nameMatch) defaultWorkerName = nameMatch[1];
      const indexMatch = content.match(/index_name\s*=\s*["']([^"']+)["']/);
      if (indexMatch) defaultIndexName = indexMatch[1];
    }
  } catch {}

  const vec = checkExistingVectorizeIndex(defaultIndexName);
  const secrets = checkExistingWorkerSecrets(defaultWorkerName);
  const deployments = checkExistingWorkerDeployments(defaultWorkerName);

  return {
    isExisting: vec.exists || secrets.hasAuthToken || deployments.deployed,
    defaultIndexName,
    defaultWorkerName,
    vec,
    secrets,
    deployments,
  };
}

async function handleVectorizeConfig(savedConfig) {
  printStep(2, 4, t('step_2_title'));
  printCard(t('vec_card_title'), t('vec_card_lines'));

  const defaultIndexName = (savedConfig?.indexName && /^[a-zA-Z0-9_-]+$/.test(savedConfig.indexName))
    ? savedConfig.indexName
    : 'github-stars';
  let indexName = defaultIndexName;
  while (true) {
    const raw = await askQuestion(t('vec_index_prompt'), defaultIndexName);
    const trimmed = (raw || defaultIndexName).trim();
    if (/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
      indexName = trimmed;
      break;
    }
    console.log(c.red(currentLocale === 'zh'
      ? '❌ 索引名称仅允许包含字母、数字、下划线和连字符。'
      : '❌ Index name may only contain letters, numbers, underscores, and hyphens.'));
  }

  console.log(c.cyan(t('vec_checking_remote', { name: indexName })));
  const existing = checkExistingVectorizeIndex(indexName);

  if (existing.exists) {
    console.log(c.green('\n' + t('vec_remote_found', { name: indexName })));
    if (existing.dimensions) {
      console.log(c.gray(t('vec_dim_info', { dim: c.bold(existing.dimensions), metric: existing.metric || 'cosine' })));
    }
    console.log(c.green(t('vec_preserve_note') + '\n'));
    return {
      indexName,
      dimensions: existing.dimensions || savedConfig?.dimensions || 1536,
      metric: existing.metric || 'cosine',
      isNew: false,
    };
  }

  console.log(c.yellow(t('vec_not_found_create', { name: indexName }) + '\n'));

  const modelOptions = MODEL_PRESETS.map((m) => ({
    label: `${m.name} (${m.dimensions ? m.dimensions + (currentLocale === 'zh' ? ' 维' : ' dims') : (currentLocale === 'zh' ? '自定义' : 'Custom')})`,
    hint: currentLocale === 'zh' ? m.hint_zh : m.hint_en,
    value: m,
  }));

  const selectedOpt = await askSelect(
    t('vec_model_select_prompt'),
    modelOptions,
    0
  );

  let dimensions = selectedOpt.value.dimensions;
  let modelName = selectedOpt.value.name;

  if (dimensions === 0) {
    while (true) {
      const inputDim = await askQuestion(t('vec_custom_dim_prompt'), '1536');
      const parsed = parseInt(inputDim, 10);
      if (!isNaN(parsed) && parsed > 0) {
        dimensions = parsed;
        modelName = `Custom (${dimensions})`;
        break;
      }
      console.log(c.red(t('vec_custom_dim_invalid')));
    }
  }

  console.log(c.cyan('\n' + t('vec_creating_index', { name: indexName, dim: dimensions, metric: 'cosine' })));
  const createRes = runWrangler([
    'vectorize',
    'create',
    indexName,
    `--dimensions=${dimensions}`,
    '--metric=cosine',
  ]);

  if (createRes.status !== 0) {
    console.error(c.red(t('vec_create_failed')));
    console.error(createRes.stderr || createRes.stdout);
    throw new Error('Vectorize creation failed');
  }

  console.log(c.green(t('vec_create_success', { name: indexName }) + '\n'));
  return {
    indexName,
    dimensions,
    metric: 'cosine',
    modelName,
    isNew: true,
  };
}

// ======================== AUTH_TOKEN 配置 ========================
function generateRandomToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function handleAuthTokenConfig(savedConfig, keepRemoteSecret = false) {
  printStep(3, 4, t('step_3_title'));
  printCard(t('token_card_title'), t('token_card_lines'));

  if (keepRemoteSecret) {
    console.log(c.green('ℹ️ ' + (currentLocale === 'zh' ? '远端已有 AUTH_TOKEN，默认保留无需重置。' : 'Remote AUTH_TOKEN detected, preserved by default.')));
    const override = await askConfirm(currentLocale === 'zh' ? '是否要重新生成并覆盖 AUTH_TOKEN？' : 'Do you want to regenerate and overwrite AUTH_TOKEN?', false);
    if (!override) {
      return { token: savedConfig?.authToken || '', keepRemote: true };
    }
  }

  if (savedConfig?.authToken) {
    console.log(c.green(t('token_detected_saved', { token: c.bold(savedConfig.authToken.slice(0, 8) + '...' + savedConfig.authToken.slice(-6)) })));
    const keepExisting = await askConfirm(t('token_keep_prompt'), true);
    if (keepExisting) {
      return { token: savedConfig.authToken, keepRemote: false };
    }
  }

  const generated = generateRandomToken();
  const tokenChoice = await askSelect(
    t('token_method_prompt'),
    [
      {
        label: t('token_opt_auto'),
        hint: t('token_opt_auto_hint', { preview: generated.slice(0, 10) }),
        value: 'auto',
      },
      {
        label: t('token_opt_custom'),
        hint: t('token_opt_custom_hint'),
        value: 'custom',
      },
    ],
    0
  );

  let finalToken = generated;
  if (tokenChoice.value === 'custom') {
    while (true) {
      const input = await askQuestion(t('token_input_custom'));
      if (input && input.length >= 8) {
        finalToken = input;
        break;
      }
      console.log(c.red(t('token_length_warn')));
    }
  }

  console.log(c.green(t('token_set_success', { preview: finalToken.slice(0, 8) }) + '\n'));
  return { token: finalToken, keepRemote: false };
}

// ======================== 部署与验证 ========================
function syncWranglerToml(indexName) {
  try {
    let content = fs.readFileSync(WRANGLER_TOML, 'utf-8');
    if (/index_name\s*=\s*["'][^"']+["']/.test(content)) {
      const updated = content.replace(
        /index_name\s*=\s*["'][^"']+["']/,
        `index_name = "${indexName}"`
      );
      if (updated !== content) {
        fs.writeFileSync(WRANGLER_TOML, updated, 'utf-8');
        console.log(c.gray(`  ✓ Synchronized wrangler.toml index_name = "${indexName}"`));
      }
    }
  } catch (err) {
    console.warn(c.yellow(`⚠️ Sync wrangler.toml failed: ${err.message}`));
  }
}

function putWranglerSecret(authToken) {
  console.log(c.cyan(t('setting_secret')));
  const res = runWranglerWithInput(['secret', 'put', 'AUTH_TOKEN'], authToken + '\n');

  if (res.status !== 0) {
    console.error(c.red(`❌ Wrangler secret put failed: ${res.stderr || res.stdout}`));
    throw new Error('AUTH_TOKEN secret configuration failed');
  }
  console.log(c.green(t('secret_set_success')));
}

function deployWorker() {
  console.log(c.cyan(t('deploying_worker')));
  const res = runWrangler(['deploy']);
  const rawOutput = (res.stdout || '') + (res.stderr || '');
  const cleanOutput = stripAnsi(rawOutput);

  if (res.status !== 0) {
    console.error(c.red(t('deploy_failed')));
    console.error(rawOutput);
    throw new Error('Worker deployment failed');
  }

  console.log(c.green(t('deploy_success')));

  const urlMatch = cleanOutput.match(/https:\/\/[a-zA-Z0-9_\-.]+\.workers\.dev/i);
  if (urlMatch) {
    return urlMatch[0].trim();
  }
  return null;
}

function normalizeUrl(url) {
  if (!url) return '';
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return 'https://' + trimmed;
  }
  return trimmed;
}

async function testWorkerConnectivity(workerUrl, authToken) {
  if (!workerUrl || !authToken) return false;
  const normalized = normalizeUrl(workerUrl);
  console.log(c.cyan(t('testing_worker', { url: normalized })));
  try {
    const targetUrl = normalized.replace(/\/+$/, '') + '/status';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (resp.ok) {
      const data = await resp.json();
      console.log(c.green(t('test_success')));
      if (data.vectorCount !== undefined) {
        console.log(c.gray(t('test_info', { count: c.bold(data.vectorCount), dim: c.bold(data.dimensions) })));
      }
      return true;
    } else {
      console.warn(c.yellow(t('test_warn_status', { status: resp.status, statusText: resp.statusText })));
      return false;
    }
  } catch (err) {
    console.warn(c.yellow(t('test_warn_err', { err: err.message })));
    console.warn(c.gray(t('test_warn_dns')));
    return false;
  }
}

function printHelp() {
  console.log(`
${c.bold(t('help_desc'))}

${c.bold(t('help_usage'))}
  node scripts/deploy-vector.mjs [options]
  npm run deploy:vector [options]

${c.bold(t('help_options'))}
  -h, --help       ${t('help_opt_help')}
  -q, --quick      ${t('help_opt_quick')}
  -s, --status     ${t('help_opt_status')}
  --lang=zh|en     ${t('help_opt_lang')}
`);
}

// ======================== 主流程 ========================
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) {
    printHelp();
    process.exit(0);
  }

  checkNodeEnvironment();
  banner();

  const savedConfig = loadLocalConfig();

  // 命令行参数: --status
  if (args.includes('-s') || args.includes('--status')) {
    if (!savedConfig?.workerUrl || !savedConfig?.authToken) {
      console.error(c.red(currentLocale === 'zh' ? '❌ 未找到本地配置记录，请先运行部署向导。' : '❌ No local config found, please run deployment wizard first.'));
      process.exit(1);
    }
    await testWorkerConnectivity(savedConfig.workerUrl, savedConfig.authToken);
    process.exit(0);
  }

  await ensureDependencies();

  // 命令行参数: --quick
  if (args.includes('-q') || args.includes('--quick')) {
    if (!savedConfig?.workerUrl) {
      console.error(c.red(currentLocale === 'zh' ? '❌ 未找到本地配置记录，无法执行快速部署。' : '❌ No local config found for quick deployment.'));
      process.exit(1);
    }
    console.log(c.cyan(t('quick_start')));
    syncWranglerToml(savedConfig.indexName || 'github-stars');
    if (savedConfig.authToken) {
      putWranglerSecret(savedConfig.authToken);
    }
    const url = deployWorker() || savedConfig.workerUrl;
    if (savedConfig.authToken) {
      await testWorkerConnectivity(url, savedConfig.authToken);
    }
    savedConfig.workerUrl = url;
    savedConfig.lastDeployedAt = new Date().toISOString();
    saveLocalConfig(savedConfig);
    showFinalSuccessCard(url, savedConfig.authToken, savedConfig.dimensions);
    return;
  }

  // 1. 若已有本地配置，提供快速通道
  if (savedConfig && savedConfig.workerUrl) {
    printCard(t('local_record_title'), [
      t('local_record_url', { url: c.bold(savedConfig.workerUrl) }),
      t('local_record_index', { index: c.bold(savedConfig.indexName || 'github-stars'), dim: savedConfig.dimensions || 1536 }),
      t('local_record_token', { token: savedConfig.authToken ? savedConfig.authToken.slice(0, 8) : '(Remote)' }),
      t('local_record_time', { time: savedConfig.lastDeployedAt ? new Date(savedConfig.lastDeployedAt).toLocaleString() : 'N/A' }),
    ], 'green');

    const mode = await askSelect(
      t('mode_select_prompt'),
      [
        {
          label: t('mode_opt_quick'),
          hint: t('mode_opt_quick_hint'),
          value: 'quick',
        },
        {
          label: t('mode_opt_full'),
          hint: t('mode_opt_full_hint'),
          value: 'full',
        },
        {
          label: t('mode_opt_test'),
          hint: t('mode_opt_test_hint'),
          value: 'test',
        },
        {
          label: t('mode_opt_lang'),
          hint: t('mode_opt_lang_hint'),
          value: 'lang',
        },
        {
          label: t('mode_opt_exit'),
          hint: '',
          value: 'exit',
        },
      ],
      0
    );

    if (mode.value === 'lang') {
      currentLocale = currentLocale === 'zh' ? 'en' : 'zh';
      savedConfig.locale = currentLocale;
      saveLocalConfig(savedConfig);
      return main();
    }

    if (mode.value === 'exit') {
      console.log(c.gray(t('op_cancelled')));
      process.exit(0);
    }

    if (mode.value === 'test') {
      await testWorkerConnectivity(savedConfig.workerUrl, savedConfig.authToken);
      process.exit(0);
    }

    if (mode.value === 'quick') {
      console.log('');
      console.log(c.cyan(t('quick_start')));
      syncWranglerToml(savedConfig.indexName || 'github-stars');
      if (savedConfig.authToken) {
        putWranglerSecret(savedConfig.authToken);
      }
      const url = deployWorker() || savedConfig.workerUrl;
      if (savedConfig.authToken) {
        await testWorkerConnectivity(url, savedConfig.authToken);
      }

      savedConfig.workerUrl = url;
      savedConfig.lastDeployedAt = new Date().toISOString();
      saveLocalConfig(savedConfig);

      showFinalSuccessCard(url, savedConfig.authToken, savedConfig.dimensions);
      return;
    }
  }

  // 2. Cloudflare 认证检查 / 登录
  const authOk = await handleCloudflareAuth();
  if (!authOk) {
    console.error(c.red('\n❌ Cloudflare auth incomplete.'));
    process.exit(1);
  }

  // 3. 自动执行老用户远端历史部署探测，避免覆盖老部署！
  console.log(c.cyan('🔍 ' + (currentLocale === 'zh' ? '正在探测 Cloudflare 账号中是否已存在历史部署...' : 'Probing Cloudflare for existing deployments...')));
  const remoteProbe = probeRemoteDeployment();

  if (remoteProbe.isExisting) {
    const existingDim = remoteProbe.vec.dimensions || 1536;
    const existingMetric = remoteProbe.vec.metric || 'cosine';

    printCard(t('remote_found_title'), [
      ...t('remote_claim_desc'),
      '',
      `• Worker:      ${c.bold(remoteProbe.defaultWorkerName)}`,
      `• Vectorize:   ${c.bold(remoteProbe.defaultIndexName)} (${existingDim} dims, ${existingMetric})`,
      `• AUTH_TOKEN:  ${remoteProbe.secrets.hasAuthToken ? c.green(currentLocale === 'zh' ? '已在云端生效 (保留)' : 'Active remotely (Preserved)') : c.gray('Not detected')}`,
    ], 'yellow');

    const claimAction = await askSelect(
      t('mode_select_prompt'),
      [
        {
          label: t('remote_opt_claim_deploy'),
          hint: t('remote_opt_claim_deploy_hint'),
          value: 'claim_deploy',
        },
        {
          label: t('remote_opt_claim_only'),
          hint: t('remote_opt_claim_only_hint'),
          value: 'claim_only',
        },
        {
          label: t('remote_opt_reconfigure'),
          hint: t('remote_opt_reconfigure_hint'),
          value: 'reconfigure',
        },
        {
          label: t('mode_opt_lang'),
          hint: t('mode_opt_lang_hint'),
          value: 'lang',
        },
      ],
      0
    );

    if (claimAction.value === 'lang') {
      currentLocale = currentLocale === 'zh' ? 'en' : 'zh';
      return main();
    }

    if (claimAction.value === 'claim_deploy' || claimAction.value === 'claim_only') {
      console.log('');
      console.log(c.cyan('📌 ' + t('remote_token_claim_prompt')));
      const tokenInput = await askQuestion(t('step_3_title'), '');
      
      let finalAuthToken = tokenInput.trim();
      let workerUrl = '';

      if (claimAction.value === 'claim_deploy') {
        syncWranglerToml(remoteProbe.defaultIndexName);
        if (finalAuthToken) {
          putWranglerSecret(finalAuthToken);
        }
        workerUrl = deployWorker() || '';
      }

      if (!workerUrl) {
        workerUrl = await askQuestion(t('worker_url_prompt'));
        workerUrl = normalizeUrl(workerUrl);
      }

      if (finalAuthToken) {
        await testWorkerConnectivity(workerUrl, finalAuthToken);
      }

      const claimedConfig = {
        workerName: remoteProbe.defaultWorkerName,
        indexName: remoteProbe.defaultIndexName,
        dimensions: existingDim,
        metric: existingMetric,
        authToken: finalAuthToken,
        workerUrl,
        claimedFromRemote: true,
        lastDeployedAt: new Date().toISOString(),
      };
      saveLocalConfig(claimedConfig);

      console.log(c.green('\n' + t('remote_claimed_saved', { file: 'cloudflare-worker/.deploy-config.json' })));
      showFinalSuccessCard(workerUrl, finalAuthToken, existingDim);
      return;
    }
  }

  // 4. 全新部署向导流程
  const vecConfig = await handleVectorizeConfig(savedConfig);
  const tokenConfig = await handleAuthTokenConfig(savedConfig, Boolean(remoteProbe.secrets?.hasAuthToken));

  printStep(4, 4, t('step_4_title'));
  syncWranglerToml(vecConfig.indexName);
  if (!tokenConfig.keepRemote) {
    putWranglerSecret(tokenConfig.token);
  }
  
  let workerUrl = deployWorker();
  if (!workerUrl) {
    if (savedConfig?.workerUrl) {
      workerUrl = savedConfig.workerUrl;
    } else {
      console.log(c.yellow(t('worker_url_missing')));
      const inputUrl = await askQuestion(t('worker_url_prompt'));
      workerUrl = normalizeUrl(inputUrl);
    }
  }

  if (tokenConfig.token) {
    await testWorkerConnectivity(workerUrl, tokenConfig.token);
  }

  const newConfig = {
    workerName: 'github-stars-vectorize',
    indexName: vecConfig.indexName,
    dimensions: vecConfig.dimensions,
    metric: vecConfig.metric,
    authToken: tokenConfig.token,
    workerUrl,
    modelName: vecConfig.modelName || savedConfig?.modelName || 'Custom',
    lastDeployedAt: new Date().toISOString(),
  };
  saveLocalConfig(newConfig);

  showFinalSuccessCard(workerUrl, tokenConfig.token, vecConfig.dimensions);
}

function showFinalSuccessCard(workerUrl, authToken, dimensions) {
  console.log('');
  console.log(c.green('┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓'));
  console.log(c.green('┃') + c.bold(`  ${t('final_success_title').padEnd(70).slice(0, 70)}`) + c.green('┃'));
  console.log(c.green('┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛'));
  console.log('');
  
  const tokenDisplay = authToken
    ? c.green(c.bold(authToken))
    : c.yellow(t('final_card_token_keep'));

  printCard(t('final_card_title'), [
    t('final_card_settings_path'),
    '',
    t('final_card_url'),
    `   ${c.cyan(c.bold(workerUrl))}`,
    '',
    t('final_card_token'),
    `   ${tokenDisplay}`,
    '',
    t('final_card_dim', { dim: c.bold(dimensions) }),
    c.gray(t('final_card_saved_tip')),
    c.gray(t('final_card_next_tip')),
  ], 'green');

  console.log(c.bold(c.cyan(t('final_next_step') + '\n')));
}

main().catch((err) => {
  console.error(c.red(`\n❌ Error during deployment: ${err.message}`));
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
});
