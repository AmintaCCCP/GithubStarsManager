# 审计与质量门禁摘要

## 代码与类型审计

本轮审计清理了共享 shadcn 原语的 Fast Refresh 非组件导出警告，补齐 `autoSync.githubToken.test.ts` 的 Vitest 显式导入，修复 `BackendPanel.test.tsx` 的未使用参数，并为 `githubListsApi.ts` 的分页响应和游标补齐显式类型。`VectorSearchSettings.tsx` 的未使用 Hook 依赖也已移除。当前 `npm run lint` 与 `npx tsc -b` 均通过且没有诊断输出。

## 设计系统审计

全局主题已引入 shadcn 默认语义变量：background、foreground、card、popover、primary、secondary、muted、accent、destructive、border、input、ring 和 radius。共享 Button、Badge、Input、Textarea、Card、Select、Checkbox、Switch、RadioGroup、Slider、Tabs、Dialog 与 AlertDialog 已采用官方 demo 风格的默认变体和状态。旧 Linear 类名保留为兼容别名，但其实际颜色已映射到 shadcn 语义变量，业务逻辑和状态流未改变。

## 安全审计

`npm audit --omit=dev --audit-level=high` 最终报告 `found 0 vulnerabilities`。仓库没有使用 `react-router-dom`，因此移除了该未使用依赖及其传递漏洞来源；没有执行破坏性路由升级。

## UI 与交互走查

生产预览已走查仓库页、设置页、AI 配置页、新增 AI 表单、WebDAV 空状态、备份恢复面板和主题共享控件。重点复测了导航 active 状态、AI 搜索空查询 disabled 状态、Radix Select 打开与切换、Checkbox 展开默认提示词、Textarea、Switch checked 状态、取消表单和空状态恢复。AI 搜索及主操作按钮的深色主题前景色覆盖问题已修复。浏览器控制台仅有预期的应用初始化与本地模式信息，没有未捕获异常或 React/Radix 警告。

## 最终质量门禁

| 检查项 | 结果 |
|---|---|
| `npm run lint` | 通过 |
| `npx tsc -b` | 通过 |
| `npm run test:run` | 29 个测试文件、326 个测试全部通过 |
| `npm run build` | 通过，无 chunk 警告 |
| `git diff --check` | 通过 |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
