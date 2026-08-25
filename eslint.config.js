import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * Business services a View component may never import directly. These modules own remote
 * calls or Store mutation; they belong behind a hook in src/features/.../hooks/**.
 * See docs/adr/0001-frontend-layering.md for the layering contract and the phasing rationale.
 *
 * Infrastructure utilities (logger, isElectron/electronProxy, indexedDbStorage,
 * mcpElectronBridge, aiRequestLimiter, discoveryAnalysisStorage) are intentionally NOT
 * banned — they are tools, not orchestration.
 */
const BANNED_COMPONENT_SERVICE_IMPORTS = [
  'githubApi',
  'aiService',
  'aiAnalysisHelper',
  'aiAnalysisOptimizer',
  'vectorSearchService',
  'autoSync',
  'webdavService',
  'backendAdapter',
  'rpcDownloadService',
  'githubApiFactory',
].map((name) => `**/services/${name}`);

/**
 * Phased allowlist: components whose operations have NOT yet been lifted into a hook.
 * The boundary rule is enforced everywhere in src/components/** EXCEPT these files.
 * Each entry is tech debt with an expiration date — a follow-up PR that migrates the
 * component removes it from this list. See ADR §"Phased enforcement".
 *
 * `src/components/ui/**` is never allowlisted: primitives must never touch a business
 * service, so any new violation there fails lint immediately.
 */
const COMPONENT_BOUNDARY_ALLOWLIST = [
  'src/components/SearchBar.tsx',
  'src/components/ReadmeModal.tsx',
  'src/components/LoginScreen.tsx',
  'src/components/GistCard.tsx',
  'src/components/GistDetailModal.tsx',
  'src/components/GistEditorModal.tsx',
  'src/components/ReleaseCard.tsx',
  'src/components/ReleaseSourceSettingsModal.tsx',
  'src/components/SubscriptionRepoCard.tsx',
  'src/components/CategorySidebar.tsx',
  'src/components/RepositoryEditModal.tsx',
  'src/components/DebugModeIndicator.tsx',
  'src/components/SettingsPanel.tsx',
];

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true, allowExportNames: ['useDialog'] },
      ],
    },
  },
  {
    /**
     * Boundary rule for View components: no direct imports of business services.
     * Tests are exempt so vi.mock('../services/...') in *.test.tsx stays legal.
     * The phased allowlist exempts not-yet-migrated components; see ADR §"Phased enforcement".
     */
    files: ['src/components/**/*.{ts,tsx}'],
    ignores: [
      'src/components/**/*.test.{ts,tsx}',
      ...COMPONENT_BOUNDARY_ALLOWLIST,
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: BANNED_COMPONENT_SERVICE_IMPORTS,
              message:
                'View components must not import business services directly. Move the call into a hook in src/features/.../hooks/** and import the hook instead. See docs/adr/0001-frontend-layering.md.',
            },
          ],
        },
      ],
    },
  },
  {
    /**
     * Purity rule for application commands: no React, no JSX, no DOM globals, no service or
     * Store coupling. These modules are pure (state, input) => state functions.
     */
    files: ['src/features/*/application/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message:
                'Application command modules must be pure (state, input) => state. No React. See docs/adr/0001-frontend-layering.md.',
            },
            {
              name: 'react-dom',
              message:
                'Application command modules must be pure (state, input) => state. No react-dom. See docs/adr/0001-frontend-layering.md.',
            },
          ],
          patterns: [
            {
              group: ['**/store/useAppStore', '**/store/useAppStore.ts', '**/services/**'],
              message:
                'Application command modules must not import the Store or any service. They are pure state transitions. See docs/adr/0001-frontend-layering.md.',
            },
          ],
        },
      ],
    },
  }
);
