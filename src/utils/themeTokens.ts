/**
 * Theme Token（开发守则 §14）。
 *
 * 用户偏好以 CSS 变量与 `data-*` 属性落到 `<html>` 上，组件不依赖任何 DOM selector。
 * 主题预设是通过 `[data-theme='id']` 的样式表生效的，所以这里用**内联**变量覆盖它，
 * 优先级确定；用户把某项恢复默认时把内联属性删掉，预设的值自动重新生效。
 */
import type { ThemeAnimation, ThemeRadius, ThemeTokens } from '../types/themeTokens';

export type { ThemeAnimation, ThemeRadius, ThemeTokens } from '../types/themeTokens';

export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  accentColor: null,
  fontScale: 1,
  radius: 'default',
  animation: 'normal',
};

/** 可选的强调色（与主题预设的色相拉开，深浅两种模式都能看清）。 */
export const ACCENT_PRESETS = [
  '#2563eb', '#7c3aed', '#db2777', '#dc2626',
  '#ea580c', '#ca8a04', '#16a34a', '#0891b2',
] as const;

export const ACCENT_PRESET_NAME_KEYS: Record<(typeof ACCENT_PRESETS)[number], string> = {
  '#2563eb': 'themeSettingsCard.color-blue',
  '#7c3aed': 'themeSettingsCard.color-violet',
  '#db2777': 'themeSettingsCard.color-pink',
  '#dc2626': 'themeSettingsCard.color-red',
  '#ea580c': 'themeSettingsCard.color-orange',
  '#ca8a04': 'themeSettingsCard.color-yellow',
  '#16a34a': 'themeSettingsCard.color-green',
  '#0891b2': 'themeSettingsCard.color-cyan',
};

export const FONT_SCALE_OPTIONS = [0.9, 1, 1.1, 1.25] as const;

/** 与 Tailwind 的 `--radius` 派生链一致：只覆盖根变量，--ui-radius-* 会跟着变。 */
const RADIUS_VALUES: Record<Exclude<ThemeRadius, 'default'>, string> = {
  none: '0rem',
  small: '0.25rem',
  medium: '0.5rem',
  large: '0.75rem',
};

const HEX_RE = /^#([0-9a-f]{6})$/i;
const HSL_TRIPLET_RE = /^(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/** 把偏好收敛到合法范围；任何脏值（旧快照、手改的 localStorage）都回落到默认。 */
export const normalizeThemeTokens = (value: unknown): ThemeTokens => {
  if (!value || typeof value !== 'object') return { ...DEFAULT_THEME_TOKENS };
  const record = value as Record<string, unknown>;

  const accentColor = typeof record.accentColor === 'string' && HEX_RE.test(record.accentColor.trim())
    ? record.accentColor.trim().toLowerCase()
    : null;

  const rawScale = typeof record.fontScale === 'number' && Number.isFinite(record.fontScale)
    ? record.fontScale
    : DEFAULT_THEME_TOKENS.fontScale;

  const radius = (['default', 'none', 'small', 'medium', 'large'] as const)
    .includes(record.radius as ThemeRadius) ? record.radius as ThemeRadius : DEFAULT_THEME_TOKENS.radius;

  const animation = record.animation === 'reduced' ? 'reduced' : 'normal';

  return {
    accentColor,
    // 允许一点余量，但挡住 0.5/3 这种会被误设的极端值
    fontScale: clamp(rawScale, 0.75, 1.5),
    radius,
    animation,
  };
};

/** `#rrggbb` → `H S% L%`，与 index.css 里 HSL 三元组的写法一致。 */
export const hexToHslTriplet = (hex: string): string | null => {
  const match = HEX_RE.exec(hex.trim());
  if (!match) return null;
  const int = Number.parseInt(match[1], 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;

  let hue = 0;
  let saturation = 0;
  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;

  const round = (value: number) => Math.round(value * 10) / 10;
  return `${round(hue)} ${round(saturation * 100)}% ${round(lightness * 100)}%`;
};

const hslToRgb = (hue: number, saturation: number, lightness: number): [number, number, number] => {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const segment = ((hue % 360) + 360) % 360 / 60;
  const x = chroma * (1 - Math.abs((segment % 2) - 1));
  const [r1, g1, b1] = segment < 1 ? [chroma, x, 0]
    : segment < 2 ? [x, chroma, 0]
      : segment < 3 ? [0, chroma, x]
        : segment < 4 ? [0, x, chroma]
          : segment < 5 ? [x, 0, chroma]
            : [chroma, 0, x];
  const offset = lightness - chroma / 2;
  return [r1 + offset, g1 + offset, b1 + offset];
};

const parseHslTriplet = (triplet: string): [number, number, number] | null => {
  const match = HSL_TRIPLET_RE.exec(triplet.trim());
  if (!match) return null;
  return hslToRgb(Number(match[1]), clamp(Number(match[2]) / 100, 0, 1), clamp(Number(match[3]) / 100, 0, 1));
};

/** Convert a preset HSL triplet to the six-digit value required by `<input type="color">`. */
export const hslTripletToHex = (triplet: string): string | null => {
  const rgb = parseHslTriplet(triplet);
  if (!rgb) return null;
  return `#${rgb.map((channel) => Math.round(clamp(channel, 0, 1) * 255).toString(16).padStart(2, '0')).join('')}`;
};

const parseHex = (hex: string): [number, number, number] | null => {
  const match = HEX_RE.exec(hex.trim());
  if (!match) return null;
  const int = Number.parseInt(match[1], 16);
  return [((int >> 16) & 0xff) / 255, ((int >> 8) & 0xff) / 255, (int & 0xff) / 255];
};

const relativeLuminance = ([r, g, b]: [number, number, number]): number => {
  const toLinear = (channel: number) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
};

const contrastRatio = (left: [number, number, number], right: [number, number, number]): number => {
  const a = relativeLuminance(left);
  const b = relativeLuminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

/** 亮底配深字、暗底配浅字：按相对亮度挑一个能读的前景色。 */
export const pickPrimaryForeground = (hex: string): string => {
  const accent = parseHex(hex);
  if (!accent) return '0 0% 100%';
  const black: [number, number, number] = [0, 0, 0];
  const white: [number, number, number] = [1, 1, 1];
  return contrastRatio(accent, black) >= contrastRatio(accent, white)
    ? '0 0% 0%'
    : '0 0% 100%';
};

/** Keep the chosen hue/saturation, but adjust lightness until it is visible on the surface. */
export const pickAccentEmphasis = (
  hex: string,
  surfaceTriplet: string,
  minimumContrast = 4.5,
): string | null => {
  const accent = parseHex(hex);
  const surface = parseHslTriplet(surfaceTriplet);
  const selectedTriplet = hexToHslTriplet(hex);
  if (!accent || !surface || !selectedTriplet) return null;
  const targetContrast = Math.max(1, minimumContrast);
  if (contrastRatio(accent, surface) >= targetContrast) return selectedTriplet;

  const match = HSL_TRIPLET_RE.exec(selectedTriplet);
  if (!match) return null;
  const hue = Number(match[1]);
  const saturation = Number(match[2]);
  const lightness = Number(match[3]);
  for (let distance = 0.5; distance <= 100; distance += 0.5) {
    for (const candidate of [lightness - distance, lightness + distance]) {
      if (candidate < 0 || candidate > 100) continue;
      if (contrastRatio(hslToRgb(hue, saturation / 100, candidate / 100), surface) >= targetContrast) {
        return `${hue} ${saturation}% ${Math.round(candidate * 10) / 10}%`;
      }
    }
  }
  return selectedTriplet;
};

interface TokenStyle {
  /** 需要写入或删除的内联 CSS 变量；null 表示恢复默认（删掉内联值）。 */
  variables: Record<string, string | null>;
  fontScale: number | null;
  animation: ThemeAnimation;
}

/**
 * 把偏好翻译成"要写到根节点上的东西"。默认值一律用 null，交给调用方删除内联属性，
 * 这样主题预设的值能重新生效。
 */
export const themeTokenStyle = (tokens: ThemeTokens, surfaceTriplet = '0 0% 100%'): TokenStyle => {
  const normalized = normalizeThemeTokens(tokens);
  const variables: Record<string, string | null> = {};

  const triplet = normalized.accentColor ? hexToHslTriplet(normalized.accentColor) : null;
  const emphasis = normalized.accentColor ? pickAccentEmphasis(normalized.accentColor, surfaceTriplet) : null;
  const ring = normalized.accentColor ? pickAccentEmphasis(normalized.accentColor, surfaceTriplet, 3) : null;
  variables['--primary'] = triplet;
  variables['--primary-emphasis'] = emphasis;
  variables['--ring'] = ring;
  variables['--primary-foreground'] = normalized.accentColor && triplet
    ? pickPrimaryForeground(normalized.accentColor)
    : null;

  variables['--radius'] = normalized.radius === 'default' ? null : RADIUS_VALUES[normalized.radius];

  return {
    variables,
    fontScale: normalized.fontScale === 1 ? null : normalized.fontScale,
    animation: normalized.animation,
  };
};

/** 把 token 应用到根节点；恢复默认 = 删除内联属性，让预设与基础样式表接管。 */
export const applyThemeTokens = (tokens: ThemeTokens, root: HTMLElement = document.documentElement): void => {
  const computedSurface = typeof getComputedStyle === 'function'
    ? getComputedStyle(root).getPropertyValue('--background').trim()
    : '';
  const fallbackSurface = root.classList.contains('dark') ? '222.2 84% 4.9%' : '0 0% 100%';
  const style = themeTokenStyle(tokens, computedSurface || fallbackSurface);

  for (const [name, value] of Object.entries(style.variables)) {
    if (value === null) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }

  if (style.fontScale === null) root.style.removeProperty('font-size');
  else root.style.fontSize = `${Math.round(style.fontScale * 10_000) / 100}%`;

  if (style.animation === 'reduced') root.dataset.animation = 'reduced';
  else delete root.dataset.animation;
};
