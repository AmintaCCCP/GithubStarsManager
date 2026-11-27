#!/usr/bin/env node
/**
 * Generates src/constants/themePresets.generated.ts from curated desktop
 * color palettes.
 *
 * Colors are derived using OKLab surface layering and converted to HSL triplets
 * ("H S% L%") so every `hsl(var(--token) / alpha)` usage and Tailwind alpha
 * modifier works across all presets.
 *
 * Usage: node scripts/generate-theme-presets.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------- OKLab & sRGB math ----------

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function toLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function toGamma(c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function rgbToOklab(r, g, b) {
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToRgb(c) {
  const l = Math.pow(c.L + 0.3963377774 * c.a + 0.2158037573 * c.b, 3);
  const m = Math.pow(c.L - 0.1055613458 * c.a - 0.0638541728 * c.b, 3);
  const s = Math.pow(c.L - 0.0894841775 * c.a - 1.291485548 * c.b, 3);
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [clamp01(toGamma(r)), clamp01(toGamma(g)), clamp01(toGamma(b))];
}

function mixOklab(x, y, p) {
  return {
    L: x.L * p + y.L * (1 - p),
    a: x.a * p + y.a * (1 - p),
    b: x.b * p + y.b * (1 - p),
  };
}

function parseColorToOklab(input) {
  const s = String(input).trim().toLowerCase();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    return rgbToOklab(r, g, b);
  }
  if (s.startsWith('oklch(')) {
    const inner = s.slice(6, -1).replace(/,/g, ' ').trim().split(/\s+/);
    const L = inner[0].endsWith('%') ? parseFloat(inner[0]) / 100 : parseFloat(inner[0]);
    const C = inner[1].endsWith('%') ? (parseFloat(inner[1]) / 100) * 0.4 : parseFloat(inner[1]);
    const H = (parseFloat(inner[2]) * Math.PI) / 180;
    return { L, a: C * Math.cos(H), b: C * Math.sin(H) };
  }
  throw new Error(`Unsupported color: ${input}`);
}

function srgbToHslTriplet(r, g, b) {
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
  const triplet = { h: h * 360, s: s * 100, l: l * 100 };
  if (triplet.s < 0.5) triplet.h = 0;
  return triplet;
}

function oklabToTriplet(lab) {
  const [r, g, b] = oklabToRgb(lab);
  return srgbToHslTriplet(r, g, b);
}

function round(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function fmtTriplet({ h, s, l }) {
  return `${round(h, 1)} ${round(s, 1)}% ${round(l, 1)}%`;
}

/** The exact triplet that `fmtTriplet` writes — contrast must be checked on this. */
function roundTriplet({ h, s, l }) {
  return { h: round(h, 1), s: round(s, 1), l: round(l, 1) };
}

// ---------- WCAG contrast & normalization ----------

function hslTripletToRgb({ h, s, l }) {
  const H = ((h % 360) + 360) % 360;
  const S = s / 100;
  const L = l / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((H / 60) % 2) - 1));
  const m = L - c / 2;
  let r = 0, g = 0, b = 0;
  if (H < 60) [r, g, b] = [c, x, 0];
  else if (H < 120) [r, g, b] = [x, c, 0];
  else if (H < 180) [r, g, b] = [0, c, x];
  else if (H < 240) [r, g, b] = [0, x, c];
  else if (H < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastTriplets(a, b) {
  const [l1, l2] = [relativeLuminance(hslTripletToRgb(a)), relativeLuminance(hslTripletToRgb(b))]
    .sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function shiftL(triplet, delta) {
  return { ...triplet, l: Math.min(100, Math.max(0, triplet.l + delta)) };
}

function ensureTextOnFill(fg, fill, req) {
  if (contrastTriplets(fg, fill) >= req) return { fg, fill };
  const fgLum = relativeLuminance(hslTripletToRgb(fg));
  const fillLum = relativeLuminance(hslTripletToRgb(fill));
  const dir = fillLum >= fgLum ? 1 : -1;
  let best = fill;
  let moved = false;
  for (let d = 1; d <= 30; d += 0.5) {
    const cand = roundTriplet(shiftL(fill, dir * d));
    best = cand;
    moved = true;
    if (contrastTriplets(fg, cand) >= req) return { fg, fill: cand };
  }
  for (const flipped of [{ ...fg, s: 0, l: 98 }, { ...fg, s: 0, l: 6 }]) {
    if (contrastTriplets(flipped, fill) >= req) {
      return { fg: flipped, fill };
    }
  }
  return { fg, fill: moved ? best : fill };
}

function ensureTextOnSurfaces(token, surfaces, req) {
  const worst = (t) => Math.min(...surfaces.map((s) => contrastTriplets(t, s)));
  if (worst(token) >= req) return token;
  let bestUp = null;
  let bestDown = null;
  for (let d = 0.5; d <= 60; d += 0.5) {
    if (bestUp === null && worst(shiftL(token, d)) >= req) bestUp = d;
    if (bestDown === null && worst(shiftL(token, -d)) >= req) bestDown = d;
    if (bestUp !== null && bestDown !== null) break;
  }
  const up = bestUp !== null ? shiftL(token, bestUp) : null;
  const down = bestDown !== null ? shiftL(token, -bestDown) : null;
  if (up && down) return bestUp <= bestDown ? up : down;
  if (up || down) return up ?? down;
  let best = token;
  let bestScore = worst(token);
  for (let l = 0; l <= 100; l += 1) {
    const cand = { ...token, l };
    const score = worst(cand);
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

function deriveBorderStrong(triplet, isLightMode) {
  const delta = isLightMode ? -11 : 11;
  const l = Math.min(97, Math.max(3, triplet.l + delta));
  return { ...triplet, l };
}

function textSurfaces(t) {
  return [t.background, t.card, t.popover, t.secondary, t.muted];
}

function minSurfaceContrast(triplet, surfaces) {
  return Math.min(...surfaces.map((surface) => contrastTriplets(triplet, surface)));
}

function selectionHueSource(t) {
  if (t.primary.s >= 8) return t.primary;
  return [t.ring, t.accent].find((candidate) => candidate.s >= 14) ?? t.primary;
}

function deriveSelection(t) {
  const surfaces = textSurfaces(t);
  const isLight = relativeLuminance(hslTripletToRgb(t.background)) > 0.35;
  const hueSource = selectionHueSource(t);
  const saturation = hueSource.s < 8
    ? 0
    : Math.min(62, Math.max(isLight ? 42 : 36, hueSource.s));
  const [bandLow, bandHigh] = isLight ? [55, 68] : [26, 40];
  const base = {
    h: hueSource.h,
    s: saturation,
    l: Math.min(bandHigh, Math.max(bandLow, hueSource.l)),
  };
  const passes = (candidate) =>
    minSurfaceContrast(candidate, surfaces) >= 1.55
    && contrastTriplets(t.foreground, candidate) >= 4.6;

  let selection = base;
  if (!passes(base)) {
    let best = base;
    let bestScore = -1;
    search: for (let d = 0.5; d <= 40; d += 0.5) {
      for (const dir of [1, -1]) {
        const candidate = shiftL(base, dir * d);
        if (passes(candidate)) {
          selection = candidate;
          break search;
        }
        const score = minSurfaceContrast(candidate, surfaces)
          + contrastTriplets(t.foreground, candidate);
        if (score > bestScore) {
          bestScore = score;
          best = candidate;
        }
      }
    }
    selection = passes(selection) ? selection : best;
  }

  const pair = ensureTextOnFill(t.foreground, selection, 4.5);
  return { selection: pair.fill, selectionForeground: pair.fg };
}

function deriveSearchHighlight(t, selection) {
  const surfaces = [t.card, t.popover, t.background];
  const isLight = relativeLuminance(hslTripletToRgb(t.background)) > 0.35;
  const surfaceL = (isLight ? Math.min : Math.max)(...surfaces.map((surface) => surface.l));
  const edge = isLight ? surfaceL - 8 : surfaceL + 8;
  const base = {
    h: selection.h,
    s: round(selection.s * 0.6, 1),
    l: round(selection.l + (edge - selection.l) / 2, 1),
  };
  const passes = (candidate) =>
    contrastTriplets(candidate, t.card) >= 1.3
    && contrastTriplets(candidate, t.background) >= 1.3
    && contrastTriplets(t.foreground, candidate) >= 4.6;

  if (passes(base)) return base;
  for (let d = 0.5; d <= 40; d += 0.5) {
    for (const dir of isLight ? [-1, 1] : [1, -1]) {
      const candidate = shiftL(base, dir * d);
      if (passes(candidate)) return candidate;
    }
  }
  return base;
}

function buildModePalette(spec, isLight) {
  const bgLab = parseColorToOklab(spec.background);
  const fgLab = parseColorToOklab(spec.foreground);
  const accLab = parseColorToOklab(spec.accent);
  const destLab = parseColorToOklab(spec.destructive);

  const whiteLab = parseColorToOklab('#ffffff');
  const blackLab = parseColorToOklab('#0d0e10');

  let canvasLab;
  let cardLab;
  let popoverLab;
  let raisedLab;
  let sunkenLab;
  let accentWellLab;
  let borderLab;

  if (isLight) {
    // Light: paper (card/popover) is the crispest surface; navigator canvas recedes ~4% toward fg.
    cardLab = bgLab;
    canvasLab = mixOklab(fgLab, bgLab, 0.045);
    popoverLab = cardLab;
    raisedLab = mixOklab(fgLab, cardLab, 0.03);
    sunkenLab = mixOklab(fgLab, cardLab, 0.035);
    accentWellLab = mixOklab(fgLab, cardLab, 0.07);
    borderLab = mixOklab(fgLab, cardLab, 0.12);
  } else {
    // Dark: navigator canvas is deepest; paper/card steps +4.5% toward fg; floating steps +10%.
    canvasLab = mixOklab(blackLab, bgLab, 0.28);
    cardLab = mixOklab(fgLab, canvasLab, 0.05);
    raisedLab = mixOklab(fgLab, canvasLab, 0.08);
    sunkenLab = mixOklab(fgLab, canvasLab, 0.025);
    popoverLab = spec.popoverSolid
      ? parseColorToOklab(spec.popoverSolid)
      : mixOklab(fgLab, canvasLab, 0.105);
    accentWellLab = mixOklab(fgLab, canvasLab, 0.12);
    borderLab = mixOklab(fgLab, canvasLab, 0.14);
  }

  const mutedFgLab = mixOklab(fgLab, cardLab, isLight ? 0.60 : 0.62);
  const whiteTriplet = oklabToTriplet(whiteLab);
  const darkInkTriplet = oklabToTriplet(mixOklab(blackLab, fgLab, 0.85));

  const primaryFill = oklabToTriplet(accLab);
  const destFill = oklabToTriplet(destLab);

  // Pick readable foreground on solid primary/destructive buttons
  const primaryContrastWhite = contrastTriplets(whiteTriplet, primaryFill);
  const primaryContrastDark = contrastTriplets(darkInkTriplet, primaryFill);
  const primaryFgInit = primaryContrastWhite >= 4.5 || primaryContrastWhite >= primaryContrastDark
    ? whiteTriplet
    : darkInkTriplet;

  const t = {
    background: oklabToTriplet(canvasLab),
    foreground: oklabToTriplet(fgLab),
    card: oklabToTriplet(cardLab),
    'card-foreground': oklabToTriplet(fgLab),
    popover: oklabToTriplet(popoverLab),
    'popover-foreground': oklabToTriplet(fgLab),
    primary: primaryFill,
    'primary-foreground': primaryFgInit,
    secondary: oklabToTriplet(isLight ? sunkenLab : raisedLab),
    'secondary-foreground': oklabToTriplet(fgLab),
    muted: oklabToTriplet(sunkenLab),
    'muted-foreground': oklabToTriplet(mutedFgLab),
    accent: oklabToTriplet(accentWellLab),
    'accent-foreground': oklabToTriplet(fgLab),
    destructive: destFill,
    'destructive-foreground': whiteTriplet,
    border: oklabToTriplet(borderLab),
    input: oklabToTriplet(borderLab),
    ring: primaryFill,
  };

  // Ensure surface separation between background and card
  const bgLum = relativeLuminance(hslTripletToRgb(t.background));
  const cardLum = relativeLuminance(hslTripletToRgb(t.card));
  if (Math.abs(bgLum - cardLum) < 0.015) {
    const dir = bgLum > cardLum ? 1 : -1;
    for (let d = 1.5; d <= 8; d += 0.5) {
      const cand = shiftL(t.background, dir * d);
      if (Math.abs(relativeLuminance(hslTripletToRgb(cand)) - cardLum) >= 0.015) {
        t.background = cand;
        break;
      }
    }
  }

  for (const [fillKey, fgKey] of [
    ['destructive', 'destructive-foreground'],
    ['primary', 'primary-foreground'],
    ['accent', 'accent-foreground'],
    ['secondary', 'secondary-foreground'],
  ]) {
    // Check the rounded triplets: fmtTriplet writes one decimal, and rounding
    // can drop a marginal pair (e.g. solarized dark primary) below 4.5:1.
    const pair = ensureTextOnFill(roundTriplet(t[fgKey]), roundTriplet(t[fillKey]), 4.5);
    t[fillKey] = pair.fill;
    t[fgKey] = pair.fg;
  }

  t['muted-foreground'] = ensureTextOnSurfaces(
    t['muted-foreground'],
    [t.background, t.card, t.popover, t.muted],
    4.6,
  );
  t.ring = ensureTextOnSurfaces(
    t.ring,
    [t.background, t.card, t.muted],
    3.05,
  );

  const borderStrong = deriveBorderStrong(t.border, isLight);
  const sel = deriveSelection(t);
  const hl = deriveSearchHighlight(t, sel.selection);

  return {
    background: fmtTriplet(t.background),
    foreground: fmtTriplet(t.foreground),
    card: fmtTriplet(t.card),
    'card-foreground': fmtTriplet(t['card-foreground']),
    popover: fmtTriplet(t.popover),
    'popover-foreground': fmtTriplet(t['popover-foreground']),
    primary: fmtTriplet(t.primary),
    'primary-foreground': fmtTriplet(t['primary-foreground']),
    secondary: fmtTriplet(t.secondary),
    'secondary-foreground': fmtTriplet(t['secondary-foreground']),
    muted: fmtTriplet(t.muted),
    'muted-foreground': fmtTriplet(t['muted-foreground']),
    accent: fmtTriplet(t.accent),
    'accent-foreground': fmtTriplet(t['accent-foreground']),
    destructive: fmtTriplet(t.destructive),
    'destructive-foreground': fmtTriplet(t['destructive-foreground']),
    border: fmtTriplet(t.border),
    'border-strong': fmtTriplet(borderStrong),
    input: fmtTriplet(t.input),
    ring: fmtTriplet(t.ring),
    selection: fmtTriplet(sel.selection),
    'selection-foreground': fmtTriplet(sel.selectionForeground),
    'search-highlight': fmtTriplet(hl),
  };
}

// ---------- 15 curated desktop theme definitions ----------

const CURATED_THEMES = {
  catppuccin: {
    label: 'Catppuccin',
    light: {
      background: '#eff1f5',
      foreground: '#4c4f69',
      accent: '#8839ef',
      destructive: '#d20f39',
    },
    dark: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      accent: '#cba6f7',
      destructive: '#f38ba8',
    },
  },
  dracula: {
    label: 'Dracula',
    light: {
      background: '#f7f6fb',
      foreground: '#282a36',
      accent: '#7c4dff',
      destructive: '#d6336c',
    },
    dark: {
      background: '#282a36',
      foreground: '#f8f8f2',
      accent: '#bd93f9',
      destructive: '#ff5555',
    },
  },
  ghostty: {
    label: 'Ghostty',
    light: {
      background: '#f8f9fb',
      foreground: '#1f232a',
      accent: '#3b66a8',
      destructive: '#c55757',
    },
    dark: {
      background: '#292c33',
      foreground: '#ffffff',
      accent: '#83a5d6',
      destructive: '#c55757',
    },
  },
  github: {
    label: 'GitHub',
    light: {
      background: '#ffffff',
      foreground: '#1f2328',
      accent: '#0969da',
      destructive: '#cf222e',
    },
    dark: {
      background: '#0d1117',
      foreground: '#e6edf3',
      accent: '#58a6ff',
      destructive: '#f85149',
    },
  },
  gruvbox: {
    label: 'Gruvbox',
    light: {
      background: '#fbf1c7',
      foreground: '#3c3836',
      accent: '#458588',
      destructive: '#cc241d',
    },
    dark: {
      background: '#282828',
      foreground: '#ebdbb2',
      accent: '#83a598',
      destructive: '#fb4934',
    },
  },
  haze: {
    label: 'Haze',
    light: {
      background: '#f7f7fa',
      foreground: '#1f1f26',
      accent: '#7c5ce6',
      destructive: '#dc2626',
    },
    dark: {
      background: '#16161a',
      foreground: '#f5f5f7',
      accent: '#a78bfa',
      destructive: '#ef4444',
      popoverSolid: '#2a2a2e',
    },
  },
  'night-owl': {
    label: 'Night Owl',
    light: {
      background: '#f5f8fc',
      foreground: '#112233',
      accent: '#2563c9',
      destructive: '#d9383a',
    },
    dark: {
      background: '#011627',
      foreground: '#d6deeb',
      accent: '#82aaff',
      destructive: '#ef5350',
    },
  },
  nord: {
    label: 'Nord',
    light: {
      background: '#eceff4',
      foreground: '#2e3440',
      accent: '#5e81ac',
      destructive: '#bf616a',
    },
    dark: {
      background: '#2e3440',
      foreground: '#eceff4',
      accent: '#88c0d0',
      destructive: '#bf616a',
    },
  },
  'one-dark-pro': {
    label: 'One Dark Pro',
    light: {
      background: '#fafafa',
      foreground: '#383a42',
      accent: '#4078f2',
      destructive: '#e45649',
    },
    dark: {
      background: '#282c34',
      foreground: '#c8ccd4',
      accent: '#61afef',
      destructive: '#e06c75',
    },
  },
  paper: {
    label: 'Paper',
    fontSans: "'Plus Jakarta Sans Variable', system-ui, -apple-system, sans-serif",
    fontSerif: "'Lora', ui-serif, Georgia, serif",
    fontMono: "'JetBrains Mono Variable', ui-monospace, monospace",
    light: {
      background: '#fcf9f7',
      foreground: '#2b2826',
      accent: 'oklch(0.50 0.12 255)',
      destructive: '#c2412d',
    },
    dark: {
      background: '#1c1b1a',
      foreground: '#ece8e4',
      accent: 'oklch(0.74 0.10 255)',
      destructive: '#ef7a63',
    },
  },
  pierre: {
    label: 'Pierre',
    light: {
      background: '#ffffff',
      foreground: '#24292f',
      accent: '#0077cc',
      destructive: '#d92662',
    },
    dark: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      accent: '#69b1ff',
      destructive: '#ff678d',
    },
  },
  'rose-pine': {
    label: 'Rosé Pine',
    light: {
      background: '#faf4ed',
      foreground: '#575279',
      accent: '#907aa9',
      destructive: '#b4637a',
    },
    dark: {
      background: '#191724',
      foreground: '#e0def4',
      accent: '#c4a7e7',
      destructive: '#eb6f92',
    },
  },
  solarized: {
    label: 'Solarized',
    light: {
      background: '#fdf6e3',
      foreground: '#44575e',
      accent: '#268bd2',
      destructive: '#dc322f',
    },
    dark: {
      background: '#002b36',
      foreground: '#b5c4c4',
      accent: '#268bd2',
      destructive: '#dc322f',
    },
  },
  'tokyo-night': {
    label: 'Tokyo Night',
    light: {
      background: '#f5f6fb',
      foreground: '#1f2335',
      accent: '#3d59a1',
      destructive: '#c93c5a',
    },
    dark: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      accent: '#7aa2f7',
      destructive: '#f7768e',
    },
  },
  vitesse: {
    label: 'Vitesse',
    light: {
      background: '#ffffff',
      foreground: '#393a34',
      accent: '#1e754f',
      destructive: '#ab5959',
    },
    dark: {
      background: '#121212',
      foreground: '#dbd7ca',
      accent: '#4d9375',
      destructive: '#cb7676',
    },
  },
};

const presets = Object.entries(CURATED_THEMES)
  .map(([id, def]) => ({
    id,
    labelEn: def.label,
    radius: '0.5rem',
    ...(def.fontSans ? { fontSans: def.fontSans } : {}),
    ...(def.fontMono ? { fontMono: def.fontMono } : {}),
    ...(def.fontSerif ? { fontSerif: def.fontSerif } : {}),
    lightColors: buildModePalette(def.light, true),
    darkColors: buildModePalette(def.dark, false),
    shadowColor: '0 0% 0%',
    shadowOpacity: 0.08,
    shadow: '0 1px 3px 0px hsl(var(--shadow-color) / var(--shadow-opacity))',
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

const banner = `// Generated by scripts/generate-theme-presets.mjs from curated desktop palettes.
// Colors are normalized for WCAG contrast and canvas/card surface layering —
// rerun "npm run gen:themes" instead of editing.
// DO NOT EDIT MANUALLY.
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
  selection: string;
  'selection-foreground': string;
  'search-highlight': string;
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
