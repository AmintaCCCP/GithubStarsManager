/**
 * 剪贴板工具函数
 * 提供兼容性检查和降级方案
 */

export interface ClipboardSupport {
  writeText: boolean;
  readText: boolean;
  isSecureContext: boolean;
}

/**
 * 检查剪贴板 API 支持情况
 */
export const checkClipboardSupport = (): ClipboardSupport => {
  const isSecureContext = typeof window !== 'undefined' && window.isSecureContext;
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;

  return {
    writeText: isSecureContext && !!clipboard && typeof clipboard.writeText === 'function',
    readText: isSecureContext && !!clipboard && typeof clipboard.readText === 'function',
    isSecureContext,
  };
};

/**
 * 检查是否支持写入剪贴板
 */
export const isWriteSupported = (): boolean => {
  return checkClipboardSupport().writeText;
};

/**
 * 检查是否支持读取剪贴板
 */
export const isReadSupported = (): boolean => {
  return checkClipboardSupport().readText;
};

/**
 * 获取剪贴板不支持时的错误信息
 */
export const getClipboardErrorMessage = (
  operation: 'read' | 'write',
  language: 'zh' | 'en' = 'zh'
): string => {
  const support = checkClipboardSupport();

  if (!support.isSecureContext) {
    return language === 'zh'
      ? '剪贴板功能需要使用 HTTPS 协议访问'
      : 'Clipboard requires HTTPS protocol';
  }

  if (operation === 'write' && !support.writeText) {
    return language === 'zh'
      ? '您的浏览器不支持剪贴板写入功能，请升级浏览器'
      : 'Your browser does not support clipboard write. Please upgrade your browser';
  }

  if (operation === 'read' && !support.readText) {
    return language === 'zh'
      ? '您的浏览器不支持剪贴板读取功能，请升级浏览器'
      : 'Your browser does not support clipboard read. Please upgrade your browser';
  }

  return language === 'zh'
    ? '剪贴板操作失败，请检查浏览器权限设置'
    : 'Clipboard operation failed. Please check browser permissions';
};

/**
 * 安全的剪贴板写入函数
 * 带有兼容性检查和降级方案
 */
export const safeWriteText = async (text: string): Promise<{ success: boolean; error?: string }> => {
  const support = checkClipboardSupport();

  if (!support.writeText) {
    // 尝试使用降级方案（execCommand）
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.left = '-999999px';
      textarea.style.top = '-999999px';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      const success = document.execCommand('copy');
      document.body.removeChild(textarea);

      if (success) {
        return { success: true };
      }
    } catch {
      // 降级方案失败，返回错误
    }

    return {
      success: false,
      error: getClipboardErrorMessage('write'),
    };
  }

  try {
    await navigator.clipboard.writeText(text);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: getClipboardErrorMessage('write'),
    };
  }
};

/**
 * 安全的剪贴板读取函数
 * 带有兼容性检查
 */
export const safeReadText = async (): Promise<{ success: boolean; text?: string; error?: string }> => {
  const support = checkClipboardSupport();

  if (!support.readText) {
    return {
      success: false,
      error: getClipboardErrorMessage('read'),
    };
  }

  try {
    const text = await navigator.clipboard.readText();
    return { success: true, text };
  } catch (err) {
    return {
      success: false,
      error: getClipboardErrorMessage('read'),
    };
  }
};
