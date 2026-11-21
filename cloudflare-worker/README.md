# GitHub Stars Vectorize Worker

极简 Cloudflare Worker，作为 Cloudflare Vectorize 的代理。前端负责 Embedding 生成，Worker 只负责向量的存/查/删。

## 🌟 方式一：一键交互式部署向导（强烈推荐）

无需繁琐敲击多条命令，也**无需打开 Cloudflare 网页后台**！交互式 TUI 会自动引导输入所有参数，并有详尽说明：

- **项目根目录**: 运行 `npm run deploy:vector`
- **当前 cloudflare-worker 目录**:
  - **macOS / Linux**: 运行 `./deploy.sh` 或 `node deploy.mjs`
  - **Windows**: 双击 `deploy.bat`，或在 PowerShell 中运行 `.\deploy.ps1`
  - **NPM 脚本**: 运行 `npm run deploy:interactive` 或 `npm run deploy:vector`

### 一键部署向导亮点：
1. **交互式 TUI 引导**：全流程可视化步骤与中文帮助卡片，详细说明每个参数（模型维度、AUTH_TOKEN、索引配置等）的用途与获取方式。
2. **无需打开 Cloudflare**：全流程基于 Wrangler CLI 自动完成索引探测、安全密钥注入与 Worker 部署。
3. **数据安全无虞**：**严格保留现有向量索引与历史数据**，不会升级或重置现有索引版本，无需重新索引。
4. **本地参数记忆**：参数自动安全保存在本地（`.deploy-config.json`），后续代码更新只需选择“快速重新部署”，一键完成更新，无需重复输入。
5. **部署即验**：部署完成后自动发起连通性测试，并打印清晰的结果卡片，直接复制 URL 和 Token 即可使用。

---

## 方式二：手动分步部署（开发者备用）

### 1. 前置条件
- [Cloudflare 账号](https://dash.cloudflare.com/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)
- 已登录 Wrangler (`wrangler login`)

### 2. 创建 Vectorize 索引
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

> **多账号（Issue #611 / #612）**：若多个 GitHub 账号共享同一个 Vectorize 索引，
> 请按顺序完成以下步骤：
>
> 1. 创建 `accountId` 元数据索引：
>    ```bash
>    npx wrangler vectorize create-metadata-index github-stars --property-name=accountId --type=string
>    ```
> 2. 等待元数据索引生效后，在客户端为每个已登录账号重新生成/上传向量（回填 `accountId` 元数据；**索引建立前写入的存量向量不会被该索引收录**，必须重写）。
>    - **全量重建跳过的存量向量如何处理**：元数据索引创建前上传、后来分析失败
>      （或已不再被分析）的仓库会被客户端的全量重建跳过。客户端只会为已分析
>      仓库重新生成 embedding 并上传，**没有"读取并原样重传历史向量"的接口**；
>      这类仓库的唯一回填途径是**先恢复分析状态，再重新分析并执行"重建向量索引"**。
>      **无法重新分析的仓库在恢复分析状态并完成重建之前，不会被账号过滤查询召回。**
> 3. **账号过滤冒烟检查（R2-A30 步骤更正，功能探测）**：`ACCOUNT_METADATA_INDEXED` 默认为
>    `"false"` 时，带 `accountId` 的 `/query` 会**无条件**返回
>    `ACCOUNT_METADATA_NOT_INDEXED`（开关门控），因此「请求被拒」不能作为
>    索引未生效的证据。正确流程是**临时启用 → 冒烟检查 → 失败回滚**：
>    ```bash
>    # 1) 临时以显式标记部署（不影响 wrangler.toml 默认值）
>    npx wrangler deploy --var ACCOUNT_METADATA_INDEXED:true
>    # 2) 准备探测输入：数字账号 ID + 随机向量（1536 换成你的索引维度；
>    #    随机向量即可——探测的是过滤行为，不是召回质量）
>    GITHUB_LOGIN="your-github-login"
>    export ACCOUNT_ID=$(curl -fsS "https://api.github.com/users/${GITHUB_LOGIN}" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const id=JSON.parse(d).id;if(!Number.isInteger(id))process.exit(1);console.log(id);})')
>    #    确认 $ACCOUNT_ID 为有效数字 ID（非空且为整数）后再继续冒烟检查
>    test -n "$ACCOUNT_ID" && echo "ACCOUNT_ID=$ACCOUNT_ID"
>    export VECTOR=$(node -e 'console.log(JSON.stringify(Array.from({length:1536},()=>Math.random()*2-1)))')
>    # 3) 正向探测：账号过滤查询
>    curl -s -X POST "$WORKER_URL/query" -H "Authorization: Bearer $AUTH_TOKEN" \
>      -H "Content-Type: application/json" \
>      -d "{\"vector\": $VECTOR, \"topK\": 5, \"threshold\": -1, \"accountId\": \"$ACCOUNT_ID\"}"
>    #    → 命中时每条 match 的 metadata.accountId 都必须等于 $ACCOUNT_ID
>    # 4) 负向对照：用确认无数据的账号查询，结果必须为空（matches: []）——
>    #    忽略 accountId 过滤参数的旧版 Worker 会在这里返回未过滤结果
>    curl -s -X POST "$WORKER_URL/query" -H "Authorization: Bearer $AUTH_TOKEN" \
>      -H "Content-Type: application/json" \
>      -d "{\"vector\": $VECTOR, \"topK\": 5, \"threshold\": -1, \"accountId\": \"__no_such_account__\"}"
>    ```
>    **注意：正向探测命中只能证明「账号过滤生效」，不能作为回填完成的依据**——
>    一次查询最多采样 50 条结果，未回填的向量可能恰好不在其中。临时启用后，先执行
>    `npx wrangler vectorize list-metadata-index github-stars` 确认 `accountId`
>    元数据索引已存在。若正向探测返回空结果，可能是**元数据索引尚未创建/未生效**，
>    也可能是**该账号的存量向量回填未完成**（Vectorize 在缺少元数据索引时带过滤
>    条件查询会直接返回空 `matches`，不会报错）——请先通过 `list-metadata-index`
>    确认 `accountId` 索引存在，再判断是否需要补完回填；在问题未解决前请
>    **回滚**为默认 `"false"`（重新 `npx wrangler deploy`），修复后重试。
> 4. **正式启用前核对回填覆盖**：验收依据是「元数据索引创建后，每个预期向量都有一次
>    成功重写（重新上传）的记录」——按账号把预期仓库集合与重写记录逐项核对，只有
>    所有预期项都有成功重写记录时才可确认覆盖；核对未完成或仍有未迁移项时，
>    保持默认 `"false"` 并明确处理未迁移项（见步骤 2）。
>    ⚠️ **不要用向量 ID 枚举或冒烟检查证明回填完成**：
>    - 元数据索引创建之前写入的向量即使带有账号前缀（如 `42:1`）也不会被该索引收录、
>      无法被账号过滤召回——**ID 带账号前缀不能证明该向量已在索引创建后被重写**
>      （Cloudflare 要求建立元数据索引后重新 upsert，存量向量才会进入过滤索引）；
>    - 只要另一条向量（如 `42:2`）已成功回填，正向/负向冒烟检查都可能通过，全量枚举
>      也可能看不到任何纯数字 ID——「枚举无纯数字 legacy ID」只是必要条件而非充分条件，
>      枚举与冒烟检查只能作为辅助排查手段，不能作为覆盖已确认的验收依据。
>    辅助排查示例（仅用于发现明显遗漏，不是验收依据）：
>    ```bash
>    # 全量枚举向量 ID（1000 条/页；--cursor=<nextCursor> 翻页）：
>    # 仍存在纯数字 legacy ID（无账号前缀）说明至少这些向量尚未回填；
>    # 但「没有纯数字 ID」不能反证回填完成（见上）
>    npx wrangler vectorize list-vectors github-stars --count=1000 --json
>    ```
>    **legacy 副本说明与启用前置条件**：客户端「重建向量索引」后的清理按
>    `includeLegacy:false` 执行（共享索引中无前缀向量的归属无法由客户端证明，
>    一律保留——见 `src/services/vectorSearchService.ts` 的 cleanup 约定与 Worker
>    `/cleanup` 实现），因此旧索引中的纯数字 legacy 副本（如旧的 `7` 与新写入的
>    `42:7` 并存）会一直保留：
>    - 不要把旧副本仍存在直接等同于「对应仓库尚未回填」；重复执行重建也不会删除
>      它们（重建写入新 ID `42:7`，cleanup 不会触碰 legacy 副本）；
>    - **但任何仍存在的纯数字 ID 都会让部署向导的覆盖验证失败**：验证通过
>      `wrangler vectorize list-vectors` 全量枚举向量 ID，遇到纯数字 ID 即判定
>      `legacy_present`——`--quick`/非交互部署会验证失败并**自动回滚**；交互部署
>      可选择强制保留，但只会记录为 `accountMetadataIndexVerified:false`
>      （「覆盖未确认」模式），后续快速部署不会复用该启用标记。
>    - 因此以 verified 状态启用账号过滤的唯一可执行路径是**先退役 legacy 副本**：
>      1. 逐个核实副本归属（属于哪个账号），并按目标替代向量 ID 执行带账号过滤的查询
>         （随机向量的 `topK: 5` 仅能做冒烟检查，不保证返回指定向量）：
>         ```bash
>         # 以账号 42、仓库 7 为例：按替代向量 ID 查询并叠加相同的 accountId 过滤条件
>         npx wrangler vectorize query github-stars --vector-id="42:7" --top-k=5 --filter='{"accountId":"42"}' --return-metadata=indexed
>         ```
>         确认查询结果包含确切的替代 ID（如 `42:7`）后，再删除旧副本；
>      2. 手动删除旧 ID，例如
>         `npx wrangler vectorize delete-vectors github-stars --ids 7`
>         （可一次传入多个 ID）；
>      3. 重新运行部署向导；全量枚举不再发现纯数字 ID、冒烟检查通过后，向导才会
>         写入 verified 标记。
>      **注意**：向导的枚举核对只是 verified 标记的必要条件（证明没有遗留
>      legacy 副本），**不能替代**步骤 4 要求的「每个预期向量都有一次成功重写
>      记录」的数据级验收。
>    - **注意区分纯数字 ID 与元数据缺失**：客户端在无账号路径下也会保留纯数字 ID，
>      并写入 `metadata.accountId: "default"`；若该向量在元数据索引创建后写入，
>      针对 `"default"` 的过滤查询仍可召回它。因此**纯数字 ID 本身不能证明元数据缺失，
>      也不能单独作为删除依据**（必须先核实归属与替代向量）。对于确实无法核实归属的
>      副本，保留期间向导的保守退役校验必然失败，只能以「覆盖未确认」模式强制启用，
>      部署状态不会被视为 verified。若选择该模式，请保持 `wrangler.toml` 中
>      `ACCOUNT_METADATA_INDEXED` 默认值为 `"false"`，并明确记录本次启用未通过覆盖验证；
>      补齐回填/退役副本后再重新验证。
>    确认覆盖后，不要直接把 `wrangler.toml` 中的 `ACCOUNT_METADATA_INDEXED`
>    默认值改成 `"true"`（默认值保持 `"false"`：默认 false 时 /status 返回
>    accountScopedCleanup:false，客户端的严格账号范围检索会跳过稠密召回并降级
>    为本地关键词/词法检索，不会发出无过滤的向量查询；未回填存量向量就设 true
>    会启用过滤，但旧向量仍可能无法命中）。使用部署向导在
>    **部署时写入显式标记**（后续代码更新也请使用部署向导而非直接运行 `npm run deploy`，见下方「更新部署」）：
>    ```bash
>    # 或使用交互向导（cloudflare-worker/deploy.mjs）：向导会自动执行账号过滤
>    # 冒烟检查（含归属与负向对照校验），并尝试用 wrangler vectorize list-vectors
>    # 全量枚举核对回填覆盖（采样观察到缺口、或枚举达到分页上限仍未读完时验证失败）；
>    # 通过后写入显式标记并持久化到 .deploy-config.json。
>    # CLI 跳过交互：node deploy.mjs --account-metadata-indexed=true
>    ```
>    ⚠️ **绝不能按客户端本机账号数量推断索引归属**——索引是否由当前账号独占、
>    回填是否完成，只有部署方通过上述验证才能确认。
>
> 在 `accountId` 元数据索引就绪并启用 `ACCOUNT_METADATA_INDEXED = "true"` 之前，按账号过滤的向量查询会被 Worker 拒绝（客户端会降级为本地关键词/词法检索，且会跳过按账号范围清理），以避免在缺少索引时漏召回或混入其他账号的向量。

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
```

请按是否已启用账号过滤选择对应的更新命令：

- **未启用账号过滤（默认部署）**：
  ```bash
  npm run deploy
  ```
- **已启用账号过滤（多账号部署）**：**不要直接运行 `npm run deploy`**——该命令会直接调用 `wrangler deploy` 并回退到 `wrangler.toml` 中的 `ACCOUNT_METADATA_INDEXED = "false"`，导致严格账号范围的客户端停止向量召回。请使用部署向导保留显式标记并重新验证：
  ```bash
  # 使用已验证的本地配置快速更新并重新验证
  node deploy.mjs --quick

  # 或显式指定标记更新（亦可在交互向导 npm run deploy:vector 中选择「快速重新部署」）
  node deploy.mjs --quick --account-metadata-indexed=true
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
