/**
 * 组合外部信号与超时，返回单个 AbortController。
 * 不依赖 AbortSignal.timeout / AbortSignal.any（Chrome<124 / Safari<16 不支持），
 * 用原生 AbortController 实现等价语义：任一来源中止即中止。
 * controller 中止后清理定时器与监听，避免泄漏。
 */
export function createCombinedAbortController(parentSignal: AbortSignal | undefined, timeoutMs: number): AbortController {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  controller.signal.addEventListener('abort', () => {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }, { once: true });
  return controller;
}
