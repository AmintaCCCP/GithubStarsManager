// Load polyfills first
import './polyfills.ts';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { DialogProvider } from './hooks/useDialog';
import { TooltipProvider } from './components/ui/tooltip';
import { logger } from './services/logger';
import { ensureThemeStyleTag } from './lib/themePresets';

// Self-hosted webfonts used by built-in theme presets (families load on demand).
import '@fontsource-variable/open-sans';
import '@fontsource-variable/inter';
import '@fontsource-variable/outfit';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/montserrat';
import '@fontsource-variable/dm-sans';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/fira-code';
import '@fontsource/ibm-plex-mono';
import '@fontsource/space-mono';
import '@fontsource/merriweather';
import '@fontsource/lora';
import '@fontsource/playfair-display';

logger.info('app', 'Main.tsx loading');

try {
  // Theme preset rules must exist before React renders so a persisted
  // non-default theme applies on first paint after hydration.
  ensureThemeStyleTag();

  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element not found');
  }

  logger.info('app', 'Root element found, creating React root');

  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <DialogProvider>
          <TooltipProvider delayDuration={300}>
            <App />
          </TooltipProvider>
        </DialogProvider>
      </ErrorBoundary>
    </StrictMode>
  );

  logger.info('app', 'React app rendered');
} catch (error) {
  logger.error('app', 'Failed to render React app', error);
  const strings = (() => {
    const lang = navigator.language?.startsWith('zh') ? 'zh' : 'en';
    return {
      title: lang === 'zh' ? '应用加载失败' : 'Application Failed to Load',
      desc: lang === 'zh'
        ? '您的浏览器可能不支持运行此应用。请尝试使用最新版本的 Chrome、Firefox、Safari 或 Edge。'
        : 'Your browser may not support running this app. Please try using the latest version of Chrome, Firefox, Safari, or Edge.',
      button: lang === 'zh' ? '重新加载' : 'Reload',
    };
  })();
  const fallback = document.getElementById('root') || (() => {
    const el = document.createElement('div');
    el.id = 'root';
    document.body.appendChild(el);
    return el;
  })();
  fallback.innerHTML = `
    <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; font-family: system-ui, -apple-system, sans-serif;">
      <div style="max-width: 400px; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 16px;">😵</div>
        <h1 style="font-size: 20px; font-weight: bold; margin-bottom: 8px; color: hsl(var(--foreground, 222.2 84% 4.9%));">${strings.title}</h1>
        <p style="color: hsl(var(--muted-foreground, 215.4 16.3% 46.9%)); margin-bottom: 16px;">${strings.desc}</p>
        <button onclick="window.location.reload()" style="padding: 8px 16px; background: hsl(var(--primary, 222.2 47.4% 11.2%)); color: hsl(var(--primary-foreground, 210 40% 98%)); border: none; border-radius: 6px; cursor: pointer;">${strings.button}</button>
      </div>
    </div>
  `;
}
