import type { AppLanguage } from '../i18n/languages';
import type { PluginActionResult } from './types';

type Toast = (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;

export async function applyPluginActionResult(
  result: PluginActionResult,
  toast: Toast,
  language: AppLanguage
): Promise<void> {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  if (result.type === 'notice') {
    toast(result.message, result.level);
    return;
  }
  if (result.type === 'open-external') {
    toast(t('已在浏览器中打开', 'Opened in browser'), 'success');
    return;
  }
  if (result.suggestedAction === 'copy') {
    await navigator.clipboard.writeText(result.content);
    toast(t('插件结果已复制', 'Plugin result copied'), 'success');
    return;
  }
  if (result.suggestedAction === 'save') {
    const url = URL.createObjectURL(new Blob([result.content], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'plugin-output.txt';
    anchor.click();
    URL.revokeObjectURL(url);
    toast(t('插件结果已保存', 'Plugin result saved'), 'success');
    return;
  }
  const preview = result.content.length > 500 ? `${result.content.slice(0, 500)}…` : result.content;
  toast(preview || t('插件操作完成', 'Plugin action completed'), 'info');
}
