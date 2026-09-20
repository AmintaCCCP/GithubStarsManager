/**
 * Theme Token 的类型（开发守则 §14）。
 *
 * 用户偏好只保存这几项声明式数据，落到 `<html>` 的 CSS 变量与 `data-*` 属性上；
 * 组件不依赖任何 DOM selector，也不接受注入 HTML / JS / React 组件。
 */

export type ThemeRadius = 'default' | 'none' | 'small' | 'medium' | 'large';

/** reduced = 减弱动效；enhanced 目前没有可增强的对象，先不做。 */
export type ThemeAnimation = 'normal' | 'reduced';

export interface ThemeTokens {
  /** `#rrggbb`；null 表示跟随主题预设的 primary。 */
  accentColor: string | null;
  /** 根字号缩放，1 表示不覆盖。 */
  fontScale: number;
  /** default 表示跟随主题预设的 --radius。 */
  radius: ThemeRadius;
  animation: ThemeAnimation;
}
