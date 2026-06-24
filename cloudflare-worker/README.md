# GitHub Stars Vectorize Worker

极简 Cloudflare Worker，作为 Cloudflare Vectorize 的代理。前端负责 Embedding 生成，Worker 只负责向量的存/查/删。

---

## 部署方式一：Cloudflare 网页控制台（推荐新手）

无需安装任何工具，全程在浏览器中完成。

### 第 1 步：创建 Vectorize 索引

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 左侧菜单点击 **Storage & Databases** → **Vectorize**
3. 点击 **Create index**，填写：
   - **Index name**: `github-stars`
   - **Dimensions**: 根据你选择的 Embedding 模型填写（见下方维度参考）
   - **Distance metric**: `Cosine`
4. 点击 **Create** 完成创建

> ⚠️ **维度必须与 Embedding 模型一致**，创建后不可修改。
> 常见选择：OpenAI `text-embedding-3-small` = **1536**，Ollama `nomic-embed-text` = **768**

### 第 2 步：创建 Worker

1. 左侧菜单点击 **Workers & Pages**
2. 点击 **Create** → **Create Worker**
3. 给 Worker 起个名字，如 `github-stars-vectorize`
4. 进入编辑器后，**删除右侧编辑区的所有默认代码**
5. 打开本项目的 [`worker.js`](./worker.js) 文件，**复制全部内容**粘贴到编辑器中
6. 点击 **Save and deploy**

### 第 3 步：绑定 Vectorize 索引

1. 进入刚创建的 Worker 页面
2. 点击 **Settings** → **Bindings** → **Add**
3. 选择 **Vectorize**，填写：
   - **Variable name**: `VECTORIZE`（必须大写）
   - **Vectorize index**: 选择第 1 步创建的 `github-stars`
4. 点击 **Save**

### 第 4 步：设置认证令牌

1. 在同一页面 **Settings** → **Variables and Secrets** → **Add**
2. 选择 **Secret** 类型（不是 Variable，Secret 更安全）
3. 填写：
   - **Variable name**: `AUTH_TOKEN`（必须大写）
   - **Value**: 输入一个安全的随机字符串，例如在终端运行 `openssl rand -hex 32` 生成
4. 点击 **Save and deploy**

### 第 5 步：获取 Worker URL

部署成功后，页面顶部会显示 Worker 的 URL，格式类似：
```text
https://github-stars-vectorize.<your-subdomain>.workers.dev
```

### 第 6 步：在 App 中配置

在 GitHub Stars Manager 的 **设置 → 向量搜索** 中：
- **Worker 地址**: 填入上一步的 URL
- **认证 Token**: 填入你设置的 AUTH_TOKEN 值

### 第 7 步：测试连接

在设置页点击 **测试 Worker 连接**，看到 "连接成功" 即可。

---

## 部署方式二：Wrangler CLI（推荐开发者）

### 前置条件

- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)
- 已登录 Wrangler (`wrangler login`)

### 第 1 步：创建 Vectorize 索引

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
```

### 第 2 步：安装依赖 & 部署

```bash
npm install
wrangler secret put AUTH_TOKEN
# 输入一个安全的随机字符串，例如：openssl rand -hex 32
npm run deploy
```

部署成功后，Wrangler 会输出 Worker 的 URL。

### 第 3 步：在 App 中配置

同方式一的第 6、7 步。

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `src/index.ts` | Worker 源码（TypeScript，CLI 部署使用） |
| `worker.js` | Worker 代码（纯 JS，Web UI 粘贴使用） |
| `wrangler.toml` | Wrangler 部署配置 |
| `package.json` | 依赖声明 |

> `src/index.ts` 和 `worker.js` 功能完全相同，只是语言不同。
> Web UI 部署用 `worker.js`，CLI 部署用 `src/index.ts`。

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/upsert` | 批量写入向量 |
| POST | `/query` | 向量相似度查询 |
| POST | `/delete` | 删除指定向量 |
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
