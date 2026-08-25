#!/usr/bin/env node
/**
 * Generates src/constants/themePresets.generated.ts from the vendored tweakcn
 * preset subset (scripts/theme-source/tweakcn-presets.json).
 *
 * Colors are converted to HSL triplets ("H S% L%") so every existing
 * `hsl(var(--token) / alpha)` usage and Tailwind alpha modifier keeps working
 * unchanged. Supported input formats: hex, rgb()/rgba(), hsl()/hsla(),
 * oklch() (converted through OKLab with naive channel clamping).
 *
 * Usage: node scripts/generate-theme-presets.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(
  readFileSync(join(root, 'scripts/theme-source/tweakcn-presets.json'), 'utf8'),
);

const COLOR_KEYS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
];

// ---------- color parsing ----------

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function srgbChannelToHsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default: h = ((r - g) / d + 4) / 6;
    }
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hexToRgb(hex) {
  let value = hex.slice(1);
  if (value.length === 3 || value.length === 4) {
    value = value.split('').map((c) => c + c).join('');
  }
  const num = parseInt(value.slice(0, 6), 16);
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

function parseNumberList(input) {
  return input.replace(/[/,]/g, ' ').trim().split(/\s+/).map(Number);
}

function rgbToTriplet(value) {
  const inner = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')'));
  const parts = parseNumberList(inner);
  const scale = parts[0] > 1 || parts[1] > 1 || parts[2] > 1 ? 255 : 1;
  return srgbChannelToHsl(parts[0] / scale, parts[1] / scale, parts[2] / scale);
}

function hslToTriplet(value) {
  const inner = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')'));
  const parts = parseNumberList(inner.replace(/%/g, ''));
  return { h: parts[0], s: parts[1], l: parts[2] };
}

// oklch -> sRGB via OKLab (Björn Ottosson's matrices), channels clamped.
function oklchToTriplet(value) {
  const inner = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')'));
  const parts = parseNumberList(inner);
  const L = parts[0];
  const C = parts[1];
  const hDeg = parts[2];
  const a = C * Math.cos((hDeg * Math.PI) / 180);
  const b = C * Math.sin((hDeg * Math.PI) / 180);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  let rLin = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  let gLin = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  let bLin = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

  const gamma = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  return srgbChannelToHsl(gamma(clamp01(rLin)), gamma(clamp01(gLin)), gamma(clamp01(bLin)));
}

function toTriplet(value) {
  const trimmed = String(value).trim();
  let triplet;
  if (trimmed.startsWith('#')) triplet = srgbChannelToHsl(...Object.values(hexToRgb(trimmed)));
  else if (trimmed.startsWith('rgb')) triplet = rgbToTriplet(trimmed);
  else if (trimmed.startsWith('hsl')) triplet = hslToTriplet(trimmed);
  else if (trimmed.startsWith('oklch')) triplet = oklchToTriplet(trimmed);
  else throw new Error(`Unsupported color format: ${value}`);
  // Snap near-neutral colors to hue 0: oklch matrix noise leaves random hues
  // on grays (visually irrelevant at s≈0, but noisy in diffs).
  if (triplet.s < 0.5) triplet.h = 0;
  return triplet;
}

function fmtTriplet({ h, s, l }) {
  return `${round(h, 1)} ${round(s, 1)}% ${round(l, 1)}%`;
}

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/** Derive --border-strong from --border by pushing lightness toward the page. */
function deriveBorderStrong(triplet, isLightMode) {
  const delta = isLightMode ? -11 : 11;
  const l = Math.min(97, Math.max(3, triplet.l + delta));
  return fmtTriplet({ ...triplet, l });
}

// ---------- shadow composition ----------

function px(value) {
  const raw = String(value).trim();
  const num = Number(raw.replace(/px$/, ''));
  if (!Number.isFinite(num)) {
    throw new Error(`Unsupported shadow length: ${value}`);
  }
  return `${round(num, 2)}px`;
}

/**
 * Compose one faithful box-shadow from the tweakcn recipe. Non-default themes
 * share this single recipe across subtle/elevated/dialog tokens (their designs
 * lean on borders/tints for depth); the default preset keeps its hand-tuned
 * hierarchy. Presets without shadow params fall back to tweakcn's global
 * defaults (soft 1px/3px at 0.1 opacity).
 */
function composeShadow(styles) {
  const color = styles['shadow-color'] ?? '#000000';
  const opacity = Number(styles['shadow-opacity'] ?? '0.1');
  if (!Number.isFinite(opacity)) {
    throw new Error(`Unsupported shadow-opacity: ${styles['shadow-opacity']}`);
  }
  const ox = px(styles['shadow-offset-x'] ?? '0px');
  const oy = px(styles['shadow-offset-y'] ?? '1px');
  const blur = px(styles['shadow-blur'] ?? '3px');
  const spread = px(styles['shadow-spread'] ?? '0px');
  const triplet = fmtTriplet(toTriplet(color));
  return {
    colorTriplet: triplet,
    opacity: round(clamp01(opacity), 3),
    // Emit the raw params so runtime CSS can rebuild with its own alphas.
    shadow: `${ox} ${oy} ${blur} ${spread} hsl(var(--shadow-color) / var(--shadow-opacity))`,
  };
}

/**
 * @fontsource-variable packages register families as "<Name> Variable", so
 * only those bundled families are aliased here. Regular @fontsource families,
 * including the imported serif fonts, retain their declared family names.
 */
const BUNDLED_VARIABLE_FONTS = new Set([
  'Open Sans',
  'Inter',
  'Outfit',
  'Geist',
  'Geist Mono',
  'Montserrat',
  'DM Sans',
  'Plus Jakarta Sans',
  'JetBrains Mono',
  'Fira Code',
]);

function aliasFontFamily(stack) {
  if (!stack) return stack;
  return stack
    .split(',')
    .map((part) => part.trim())
    .map((family) => {
      const bare = family.replace(/^['"]|['"]$/g, '');
      return BUNDLED_VARIABLE_FONTS.has(bare) ? `'${bare} Variable'` : family;
    })
    .join(', ');
}

// ---------- generation ----------

const presets = Object.entries(source.presets).map(([id, preset]) => {
  const lightStyles = preset.styles.light;
  const darkStyles = preset.styles.dark ?? preset.styles.light;

  const lightTriplets = {};
  const darkTriplets = {};
  for (const key of COLOR_KEYS) {
    const lightValue = lightStyles[key];
    const darkValue = darkStyles[key] ?? lightValue;
    if (!lightValue) throw new Error(`${id}: missing light color "${key}"`);
    lightTriplets[key] = toTriplet(lightValue);
    darkTriplets[key] = toTriplet(darkValue);
  }

  const lightColors = {};
  const darkColors = {};
  for (const key of COLOR_KEYS) {
    lightColors[key] = fmtTriplet(lightTriplets[key]);
    darkColors[key] = fmtTriplet(darkTriplets[key]);
  }
  lightColors['border-strong'] = deriveBorderStrong(lightTriplets.border, true);
  darkColors['border-strong'] = deriveBorderStrong(darkTriplets.border, false);

  const shadow = composeShadow(lightStyles);

  return {
    id,
    labelEn: preset.label,
    radius: lightStyles.radius ?? '0.5rem',
    fontSans: aliasFontFamily(lightStyles['font-sans']),
    fontMono: aliasFontFamily(lightStyles['font-mono']),
    fontSerif: aliasFontFamily(lightStyles['font-serif']),
    lightColors,
    darkColors,
    shadowColor: shadow.colorTriplet,
    shadowOpacity: shadow.opacity,
    shadow: shadow.shadow,
  };
}).sort((a, b) => a.id.localeCompare(b.id));

const banner = `// Generated by scripts/generate-theme-presets.mjs from
// scripts/theme-source/tweakcn-presets.json (${source._meta.source}).
// DO NOT EDIT MANUALLY — rerun "npm run gen:themes" instead.
`;

const body = `${banner}
export interface GeneratedThemePalette {
  background: string;
  foreground: string;
  card: string;
  'card-foreground': string;
  popover: string;
  'popover-foreground': string;
  primary: string;
  'primary-foreground': string;
  secondary: string;
  'secondary-foreground': string;
  muted: string;
  'muted-foreground': string;
  accent: string;
  'accent-foreground': string;
  destructive: string;
  'destructive-foreground': string;
  border: string;
  'border-strong': string;
  input: string;
  ring: string;
}

export interface GeneratedThemePreset {
  id: string;
  labelEn: string;
  radius: string;
  fontSans?: string;
  fontMono?: string;
  fontSerif?: string;
  lightColors: GeneratedThemePalette;
  darkColors: GeneratedThemePalette;
  shadowColor: string;
  shadowOpacity: number;
  /** Single canonical box-shadow shared by subtle/elevated/dialog tokens. */
  shadow: string;
}

export const GENERATED_THEME_PRESETS: GeneratedThemePreset[] = ${JSON.stringify(presets, null, 2)};
`;

const outFile = join(root, 'src/constants/themePresets.generated.ts');
writeFileSync(outFile, body);
console.log(`Wrote ${outFile} with ${presets.length} presets: ${presets.map((p) => p.id).join(', ')}`);
