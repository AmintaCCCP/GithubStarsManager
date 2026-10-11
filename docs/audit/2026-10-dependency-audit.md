# 2026-10 依赖审计决策记录

> 对应 PR：`build/desktop-deps-hardening`（PR-02 桌面打包与依赖健康）
> 审计与实施日期：2026-10-12 · Node 24 / npm 11 · 主仓 audit 基线 13 个漏洞（8 moderate + 5 high）

## 1. 审计基线（实施当日 `npm audit` 输出快照）

```
# npm audit report

braces  *
Severity: high
braces vulnerable to stack-exhaustion denial of service through deeply nested patterns
  → GHSA-vfj7-8cjw-p6xm
node_modules/braces
  chokidar 2.0.0 - 3.6.0 → tailwindcss <=3.4.19
  micromatch >=0.2.0 → fast-glob *

sprintf-js  *
Severity: moderate
sprintf-js vulnerable to denial of service through unbounded precision specifiers
  → GHSA-hp3w-g68c-fv3c
node_modules/sprintf-js
  roarr <=2.15.4
    global-agent <=3.0.0
      @electron/get 1.6.0 - 4.0.3
        app-builder-lib 26.6.0 - 27.0.0-alpha.2
          dmg-builder / electron-builder / electron-builder-squirrel-windows

13 vulnerabilities (8 moderate, 5 high)
```

- 5 个 high：全部位于 braces 链（tailwindcss@3 → chokidar@3 → braces/micromatch/fast-glob）。
- 8 个 moderate：全部位于 electron-builder 构建链（`@electron/get → global-agent → roarr → sprintf-js`）。
- 运行时依赖 `npm audit --omit=dev` = **0 vulnerabilities**；`server/` 与 `cloudflare-worker/` 独立 lock，本就为 0，本 PR 未触碰。

## 2. braces 链（5 high）：接受风险

**结论：接受，不在本 PR 修复。**

理由：

1. **仅构建期依赖**：braces 由 `tailwindcss@3 → chokidar@3` 引入，只在 Tailwind JIT 扫描 content glob 与 `vite build`/`vitest` 运行期间存在于 devDependencies 树；electron-builder 的 `files` 清单只打包 `dist/`、`build/`、`electron/` 与 `package.json`，**不包含 node_modules**，因此该链不会进入任何桌面安装产物或 Web 产物。
2. **触发条件苛刻**：漏洞为 glob 模式深度嵌套导致的栈耗尽 DoS（GHSA-vfj7-8cjw-p6xm），触发需要把恶意构造的 glob 模式喂给 braces。本仓库的 content glob 写死在 `tailwind.config.js`（仓库自有文件），构建输入不受外部控制。
3. **v3 内无修复版**：chokidar 3.x 依赖的 braces ≤3.0.3 全线受影响，Tailwind 3 范围内无升级路径。
4. **根治路径已立项**：Tailwind 3 → 4 迁移（PR-11，`build/tailwind-v4`）会将 chokidar@3 整条链移出依赖树，届时 5 个 high 归零。

## 3. electron-builder 链（8 moderate）：尝试降级 26.5.0 后按预案回退，接受风险

**结论：维持 `electron-builder ^26.15.3`，接受 8 个 moderate。**

### 3.1 计划与现场的偏差

PR-02 计划依据的审计快照中，npm audit 对 8 个 moderate 给出的修复方案是降级到 `electron-builder@26.5.0`（26.6.0 起重新引入带 global-agent 的 @electron/get）。实施当日实际执行降级并复跑 audit，结果**不降反升**：

| 状态 | 漏洞数 | 构成 |
|---|---|---|
| `^26.15.3`（基线） | 13（8 moderate + 5 high） | high 全部为 braces 链 |
| `26.5.0`（降级后实测） | **14（13 high + 1 critical）** | 新增 3 条计划快照后发布的 advisory 命中 26.5.0 树 |

降级后新增命中（均不影响 26.15.3 树）：

- `app-builder-lib <=26.14.0` **high** — GHSA-7g7r-gx96-252g（electron-updater：app-builder-lib 构建的 AppImage 搜索路径可注入）；
- `builder-util-runtime <9.7.0` **high** — GHSA-p2f4-r6v6-j797（electron-updater：跨源重定向泄露 PRIVATE-TOKEN / Authorization 凭据）；
- `tar <=7.5.20` **critical** — 经 `@electron/rebuild` 引入的 12 条 tar advisory（GHSA-34x7-hfp2-rc4v 等）。

26.5.0 会直接违背本 PR 验收标准「`npm audit` 高危仅剩 braces 链」，且严重度净恶化，故按计划第 1 节回退预案处理：回退降级项，改以本决策记录收口。

### 3.2 接受 8 个 moderate 的理由与触发条件

1. **仅构建期、不进产物**：`global-agent → roarr → sprintf-js` 是 app-builder-lib 内 `@electron/get` 的构建期传递依赖（Electron 二进制下载时的代理支持），只在本机/CI 执行 `npm install`、`electron-builder` 时存在；如上所述，node_modules 不进入安装包，产物零暴露。
2. **上游无修复版本可锁**：advisory 将 sprintf-js 的漏洞区间标为 `*`（全版本受影响），roarr/global-agent/@electron/get 在受影响区间内同样无修复版，npm overrides 无从下手；npm audit 自身给出的唯一修复方案（降级 26.5.0）已被实测证伪。
3. **持续跟踪**：后续 electron-builder 发布移除 global-agent 依赖链的版本后，由 Dependabot 的常规 bump 自然清零。

## 4. 同 PR 的其余依赖决策

- **patch/minor 清账**：以实施日 `npm outdated` 全量输出为准，凡 major 跳版本一律排除（eslint 10、eslint-plugin-react-hooks 7、vite 8、vitest 5、tailwindcss 4、zustand 5、react 19、lucide-react 1.x、jsdom 30、date-fns 4、concurrently 10、typescript 7、@testing-library/react 16、mermaid 12、@vitejs/plugin-legacy 8、ajv 8、globals 17、katex 0.19、eslint-plugin-react-refresh 0.5、@vitejs/plugin-react 6）。major 升级统一走 PR-01 引入的 Dependabot 渠道逐个验证。
- **eslint-plugin-react-hooks**：声明由 `^5.1.0-rc.0` 修正为 `^5.2.0`，与实际解析安装的稳定版对齐，消除 RC 漂移。
- **asar**：`electron-builder.yml` 由 `asar: false` 改为 `true`（见 commit 75b4ca4 的说明与 PR 自测记录）；`electron/main.js` 对 `__dirname` 的引用全部为只读资源，写入均落 userData。
- **明确不做**：不改 `package.json` 的 `version` 字段；不碰 `versions/`；不动 `server/` 与 `cloudflare-worker/` 依赖。

## 5. 残余风险与后续路径

| 风险 | 严重度 | 处置 |
|---|---|---|
| braces 链（tailwindcss@3） | 5 high（构建期） | PR-11 Tailwind v4 迁移根治 |
| @electron/get → global-agent 链 | 8 moderate（构建期） | 等待上游 electron-builder 修复版本，Dependabot 跟进 |
| electron-builder 26.5.0 降级 | 不适用 | 已按预案回退；tag 触发的 release 构建将在下个发布窗口用 26.15.3 验证三平台产物 |
