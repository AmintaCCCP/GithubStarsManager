import React, { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Error info:', errorInfo);
    this.setState({ error, errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleClearStorage = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      // Clear IndexedDB
      const req = indexedDB.deleteDatabase('github-stars-manager-db');
      req.onsuccess = () => {
        console.log('[ErrorBoundary] IndexedDB cleared');
        window.location.reload();
      };
      req.onerror = () => {
        console.error('[ErrorBoundary] Failed to clear IndexedDB');
        window.location.reload();
      };
    } catch (e) {
      console.error('[ErrorBoundary] Failed to clear storage:', e);
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
            <div className="text-center">
              <div className="text-5xl mb-4">😵</div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                应用加载出错
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                抱歉，应用遇到了问题。这可能是由于浏览器兼容性或数据损坏导致的。
              </p>
              
              {this.state.error && (
                <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 rounded text-left overflow-auto max-h-32">
                  <p className="text-sm text-red-600 dark:text-red-400 font-mono">
                    {this.state.error.toString()}
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <button
                  onClick={this.handleReload}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  重新加载页面
                </button>
                <button
                  onClick={this.handleClearStorage}
                  className="w-full px-4 py-2 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 rounded-lg hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                >
                  清除本地数据并重启
                </button>
              </div>

              <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
                <p>建议使用的浏览器：</p>
                <p>Chrome 80+ / Firefox 75+ / Safari 13+ / Edge 80+</p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
