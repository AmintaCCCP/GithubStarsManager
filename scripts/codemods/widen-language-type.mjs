#!/usr/bin/env node
/**
 * 一次性 codemod：把消费 store 语言值的 `'zh' | 'en'` 类型注解宽化为 AppLanguage。
 * 只处理白名单文件（人工逐一判定过，不含语言定义本身与 AI 模板收口类型），
 * 值比较逻辑（`language === 'zh'` 等）不受影响。
 * 用法：node scripts/codemods/widen-language-type.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const TARGETS = [
  'src/plugins/applyPluginActionResult.ts',
  'src/features/repositories/hooks/useBulkRepositoryActions.ts',
  'src/features/repository-chat/components/CitationBadge.tsx',
  'src/features/repository-chat/hooks/useTurnStatusAnnouncement.ts',
  'src/features/repository-chat/hooks/useRepositoryChat.ts',
  'src/features/repository-chat/hooks/useRepositoryChatSessions.ts',
  'src/utils/readmeVariants.ts',
  'src/utils/backendErrors.ts',
  'src/utils/clipboardUtils.ts',
  'src/utils/markdownSplitter.ts',
  'src/utils/releaseSources.ts',
  'src/components/BilingualMarkdownRenderer.tsx',
  'src/components/DiscoverySidebar.tsx',
  'src/components/RepositoryCard.tsx',
  'src/components/RepositoryChatSheet.tsx',
  'src/components/ForkCard.tsx',
  'src/components/ReleaseCard.tsx',
  'src/components/RepositoryReleaseSheet.tsx',
  'src/components/DiscoveryView.tsx',
  'src/components/RepositoryChatHistoryPanel.tsx',
  'src/components/ReleaseSourceSettingsModal.tsx',
  'src/components/ReadmeModal.tsx',
  'src/components/ReleasePluginRecommendations.tsx',
  'src/components/BulkActionToolbar.tsx',
  'src/components/SortAlgorithmTooltip.tsx',
  'src/components/SimilarViewBanner.tsx',
  'src/components/settings/DataManagementPanel.tsx',
  'src/services/repositoryChatService.ts',
  'src/services/agentToolLoop.ts',
];

let totalReplacements = 0;
for (const relative of TARGETS) {
  const file = path.join(root, relative);
  let content = readFileSync(file, 'utf8');
  const before = content;
  content = content.replaceAll(`'zh' | 'en'`, 'AppLanguage');
  if (content === before) {
    console.log(`SKIP  ${relative}`);
    continue;
  }
  totalReplacements += (before.match(/'zh' \| 'en'/g) ?? []).length;
  if (!/import\s+type\s+\{\s*AppLanguage\s*\}/.test(content) && !/import\s+\{\s*AppLanguage/.test(content)) {
    const prefix = relative.startsWith('src/') ? '../'.repeat(relative.split('/').length - 2) : '';
    const importLine = `import type { AppLanguage } from '${prefix}i18n/languages';\n`;
    const firstImport = content.search(/^import /m);
    content = content.slice(0, firstImport) + importLine + content.slice(firstImport);
  }
  writeFileSync(file, content);
  console.log(`OK    ${relative}`);
}
console.log(`done, ${totalReplacements} annotations widened`);
