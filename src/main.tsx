// Load polyfills first
import './polyfills.ts';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { DialogProvider } from './hooks/useDialog';

console.log('Main.tsx loading...');

try {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element not found');
  }

  console.log('Root element found, creating React root...');

  const root = createRoot(rootElement);
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <DialogProvider>
          <App />
        </DialogProvider>
      </ErrorBoundary>
    </StrictMode>
  );

  console.log('React app rendered');
} catch (error) {
  console.error('Failed to render React app:', error);
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
        <h1 style="font-size: 20px; font-weight: bold; margin-bottom: 8px; color: #333;">${strings.title}</h1>
        <p style="color: #666; margin-bottom: 16px;">${strings.desc}</p>
        <button onclick="window.location.reload()" style="padding: 8px 16px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer;">${strings.button}</button>
      </div>
    </div>
  `;
}
