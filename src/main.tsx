// Load polyfills first
import './polyfills.ts';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';

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
        <App />
      </ErrorBoundary>
    </StrictMode>
  );

  console.log('React app rendered');
} catch (error) {
  console.error('Failed to render React app:', error);
  // Display a fallback error message
  const rootElement = document.getElementById('root');
  if (rootElement) {
    rootElement.innerHTML = `
      <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; font-family: system-ui, -apple-system, sans-serif;">
        <div style="max-width: 400px; text-align: center;">
          <div style="font-size: 48px; margin-bottom: 16px;">😵</div>
          <h1 style="font-size: 20px; font-weight: bold; margin-bottom: 8px; color: #333;">应用加载失败</h1>
          <p style="color: #666; margin-bottom: 16px;">您的浏览器可能不支持运行此应用。请尝试使用最新版本的 Chrome、Firefox、Safari 或 Edge。</p>
          <button onclick="window.location.reload()" style="padding: 8px 16px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer;">重新加载</button>
        </div>
      </div>
    `;
  }
}
