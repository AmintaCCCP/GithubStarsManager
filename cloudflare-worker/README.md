# GitHub Stars Vectorize Worker

极简 Cloudflare Worker，作为 Cloudflare Vectorize 的代理。前端负责 Embedding 生成，Worker 只负责向量的存/查/删。

## 前置条件

- [Cloudflare 账号](https://dash.cloudflare.com/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)
- 已登录 Wrangler (`wrangler login`)

## 首次部署

### 1. 创建 Vectorize 索引

索引维度必须与你选择的 Embedding 模型一致：

```bash
# OpenAI text-embedding-3-small (1536维)
npx wrangler vectorize create github-stars --dimensions=1536 --metric=cosine

# Ollama nomic-embed-text (768维)
npx wrangler vectorize create github-stars --dimensions=768 --metric=cosine

# Cohere embed-multilingual-v3.0 (1024维)
npx wrangler vectorize create github-stars --dimensions=1024 --metric=cosine

# Gemini text-embedding-004 (768维)
npx wrangler vectorize create github-stars --dimensions=768 --metric=cosine

# 硅基流动 BAAI/bge-large-zh-v1.5 (1024维)
npx wrangler vectorize create github-stars --dimensions=1024 --metric=cosine
```

### 2. 安装依赖

```bash
npm install
```

### 3. 设置认证令牌

```bash
wrangler secret put AUTH_TOKEN
# 输入一个安全的随机字符串，例如：openssl rand -hex 32
```

### 4. 部署

```bash
npm run deploy
```

部署成功后，Wrangler 会输出 Worker 的 URL，格式类似：
```text
https://github-stars-vectorize.<your-subdomain>.workers.dev
```

### 5. 在 App 中配置

在 GitHub Stars Manager 的 **设置 → 向量搜索** 中：
- **Worker 地址**: 填入上一步的 URL
- **认证 Token**: 填入你设置的 AUTH_TOKEN 值

### 6. 测试连接

在设置页点击 **测试 Worker 连接**，看到 "连接成功" 即可。

---

## 更新部署（代码变更后）

当你更新了 Worker 代码（例如从 GitHub 拉取了新版本），需要重新部署：

```bash
cd cloudflare-worker

# 如果依赖有变更（package.json 更新了）
npm install

# 重新部署
npm run deploy
```

> **注意**：更新部署**不需要**重新创建 Vectorize 索引，已有向量数据不受影响。

---

## 更换 Embedding 模型

> ⚠️ **更换模型后必须重建索引！** 不同模型生成的向量维度不同，混用会导致查询失败。

步骤：
1. 在 App 设置中更换 Embedding 模型
2. 如果新模型的维度与旧模型不同，需要**删除旧索引并创建新索引**：
   ```bash
   # 删除旧索引
   npx wrangler vectorize delete github-stars

   # 创建新索引（维度与新模型一致）
   npx wrangler vectorize create github-stars --dimensions=1024 --metric=cosine
   ```
3. 在 App 中点击 **重建向量索引**

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `src/index.ts` | Worker 源码（TypeScript，CLI 部署使用） |
| `worker.js` | Worker 代码（纯 JS，备用） |
| `wrangler.toml` | Wrangler 部署配置 |
| `package.json` | 依赖声明 |

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/upsert` | 批量写入向量 |
| POST | `/query` | 向量相似度查询 |
| POST | `/delete` | 删除指定向量 |
| POST | `/cleanup` | 清理不在 keepIds 列表中的向量 |
| GET | `/status` | 获取索引状态 |

所有请求需要 `Authorization: Bearer <AUTH_TOKEN>` 头。

## 本地开发

```bash
npm run dev
```

## 常见 Embedding 模型维度参考

| 模型 | 维度 | 多语言 | 价格 |
|------|------|--------|------|
| OpenAI text-embedding-3-small | **1536** | ✅ | $0.02/M |
| OpenAI text-embedding-3-large | **3072** | ✅ | $0.13/M |
| Gemini text-embedding-004 | **768** | ✅ | 免费 |
| Cohere embed-multilingual-v3.0 | **1024** | ✅ | $0.1/M |
| Ollama nomic-embed-text | **768** | ✅ | 免费 |
| Ollama bge-m3 | **1024** | ✅ | 免费 |
| 硅基流动 BAAI/bge-large-zh-v1.5 | **1024** | ✅ | ¥0.5/M |
