import React, { Component, ReactNode } from 'react';
import { PROJECT_ISSUES_URL } from '../constants/project';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  showDetails: boolean;
}

const getLocalizedStrings = () => {
  const lang = navigator.language?.startsWith('zh') ? 'zh' : 'en';
  return {
    title: lang === 'zh' ? '应用加载出错' : 'Application Error',
    description: lang === 'zh'
      ? '应用遇到了问题。请查看下方错误详情或将问题反馈给我们。'
      : 'Sorry, the application encountered an issue. Please see the error details below or report the issue to us.',
    reload: lang === 'zh' ? '重新加载页面' : 'Reload Page',
    reportIssue: lang === 'zh' ? '在 GitHub 上反馈问题' : 'Report Issue on GitHub',
    toggleDetails: lang === 'zh' ? '显示/隐藏详细信息' : 'Show/Hide Details',
    errorDetails: lang === 'zh' ? '错误详情' : 'Error Details',
    stackTrace: lang === 'zh' ? '堆栈跟踪' : 'Stack Trace',
    browserHint: lang === 'zh' ? '建议使用的浏览器：' : 'Recommended browsers:',
    copyError: lang === 'zh' ? '复制错误信息' : 'Copy Error Info',
    copied: lang === 'zh' ? '已复制！' : 'Copied!',
  };
};

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, showDetails: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null, showDetails: false };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error);
    console.error('[ErrorBoundary] Error info:', errorInfo);
    this.setState({ error, errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleReportIssue = () => {
    window.open(PROJECT_ISSUES_URL, '_blank');
  };

  handleToggleDetails = () => {
    this.setState(prev => ({ showDetails: !prev.showDetails }));
  };

  handleCopyError = async () => {
    const { error, errorInfo } = this.state;
    const errorText = [
      'Error: ' + (error?.message || String(error)),
      '',
      'Stack Trace:',
      error?.stack || '',
      '',
      'Component Stack:',
      errorInfo?.componentStack || '',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(errorText);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  };

  render() {
    if (this.state.hasError) {
      const strings = getLocalizedStrings();
      const { error, errorInfo, showDetails } = this.state;

      return (
        <div className="min-h-screen bg-light-bg dark:bg-panel-dark flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-white dark:bg-panel-dark rounded-lg shadow-lg p-6">
            <div className="text-center">
              <div className="text-5xl mb-4">😵</div>
              <h1 className="text-xl font-bold text-gray-900 dark:text-text-primary mb-2">
                {strings.title}
              </h1>
              <p className="text-gray-700 dark:text-text-tertiary mb-4">
                {strings.description}
              </p>
              
              {/* 错误信息显示 */}
              {error && (
                <div className="mb-4 p-3 bg-gray-100 dark:bg-white/[0.04] rounded text-left">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-semibold text-gray-700 dark:text-text-secondary ">
                      {strings.errorDetails}
                    </span>
                    <button
                      onClick={this.handleCopyError}
                      className="text-xs px-2 py-1 bg-gray-100 dark:bg-white/[0.04] text-gray-700 dark:text-text-secondary rounded hover:bg-gray-100 dark:bg-white/[0.04] dark:hover:bg-gray-100 dark:bg-white/[0.04] transition-colors"
                    >
                      {strings.copyError}
                    </button>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-text-secondary font-mono break-words">
                    {error?.message || error?.toString() || String(error)}
                  </p>
                </div>
              )}

              {/* 详细信息折叠面板 */}
              <div className="mb-4">
                <button
                  onClick={this.handleToggleDetails}
                  className="text-sm text-brand-violet dark:text-brand-violet hover:text-gray-700 dark:text-text-secondary dark:hover:text-gray-700 dark:text-text-secondary underline"
                >
                  {strings.toggleDetails}
                </button>
                {showDetails && errorInfo && (
                  <div className="mt-2 p-3 bg-light-surface dark:bg-white/[0.04] rounded text-left overflow-auto max-h-64">
                    <p className="text-xs font-semibold text-gray-900 dark:text-text-secondary mb-2">
                      {strings.stackTrace}:
                    </p>
                    <pre className="text-xs text-gray-700 dark:text-text-tertiary font-mono whitespace-pre-wrap">
                      {error?.stack || 'No stack trace available'}
                    </pre>
                    {errorInfo?.componentStack && (
                      <>
                        <p className="text-xs font-semibold text-gray-900 dark:text-text-secondary mt-3 mb-2">
                          Component Stack:
                        </p>
                        <pre className="text-xs text-gray-700 dark:text-text-tertiary font-mono whitespace-pre-wrap">
                          {errorInfo.componentStack}
                        </pre>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div className="space-y-2">
                <button
                  onClick={this.handleReload}
                  className="w-full px-4 py-2 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors"
                >
                  {strings.reload}
                </button>
                <button
                  onClick={this.handleReportIssue}
                  className="w-full px-4 py-2 bg-light-surfacetext-gray-900 dark:bg-white/[0.04] dark:text-text-secondary rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                >
                  {strings.reportIssue}
                </button>
              </div>

              {/* 浏览器提示 */}
              <div className="mt-4 text-xs text-gray-500 dark:text-text-tertiary">
                <p>{strings.browserHint}</p>
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
