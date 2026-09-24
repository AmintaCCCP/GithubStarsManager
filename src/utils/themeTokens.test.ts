import { describe, expect, it } from 'vitest';
import {
  ACCENT_PRESETS,
  DEFAULT_THEME_TOKENS,
  applyThemeTokens,
  hexToHslTriplet,
  hslTripletToHex,
  normalizeThemeTokens,
  pickAccentEmphasis,
  pickPrimaryForeground,
  themeTokenStyle,
} from './themeTokens';

describe('normalizeThemeTokens', () => {
  it('falls back to defaults for junk input', () => {
    expect(normalizeThemeTokens(undefined)).toEqual(DEFAULT_THEME_TOKENS);
    expect(normalizeThemeTokens(null)).toEqual(DEFAULT_THEME_TOKENS);
    expect(normalizeThemeTokens('nope')).toEqual(DEFAULT_THEME_TOKENS);
    expect(normalizeThemeTokens({ accentColor: 'red', radius: 'huge', animation: 'fast', fontScale: 'big' }))
      .toEqual(DEFAULT_THEME_TOKENS);
  });

  it('keeps valid values and normalizes the accent to lower case', () => {
    expect(normalizeThemeTokens({
      accentColor: '  #2563EB  ',
      fontScale: 1.1,
      radius: 'large',
      animation: 'reduced',
    })).toEqual({ accentColor: '#2563eb', fontScale: 1.1, radius: 'large', animation: 'reduced' });
  });

  it('clamps the font scale instead of accepting extremes', () => {
    expect(normalizeThemeTokens({ fontScale: 0.1 }).fontScale).toBe(0.75);
    expect(normalizeThemeTokens({ fontScale: 4 }).fontScale).toBe(1.5);
    expect(normalizeThemeTokens({ fontScale: Number.NaN }).fontScale).toBe(1);
  });
});

describe('hexToHslTriplet', () => {
  it('converts the preset palette to HSL triplets', () => {
    for (const hex of ACCENT_PRESETS) {
      const triplet = hexToHslTriplet(hex);
      expect(triplet, hex).toMatch(/^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/);
    }
  });

  it('matches known conversions', () => {
    expect(hexToHslTriplet('#ffffff')).toBe('0 0% 100%');
    expect(hexToHslTriplet('#000000')).toBe('0 0% 0%');
    expect(hexToHslTriplet('#ff0000')).toBe('0 100% 50%');
    expect(hexToHslTriplet('#2563eb')).toBe('221.2 83.2% 53.3%');
  });

  it('rejects anything that is not a six digit hex color', () => {
    expect(hexToHslTriplet('#fff')).toBeNull();
    expect(hexToHslTriplet('2563eb')).toBeNull();
    expect(hexToHslTriplet('hsl(217 91% 60%)')).toBeNull();
    expect(hexToHslTriplet('')).toBeNull();
  });
});

describe('hslTripletToHex', () => {
  it('converts preset HSL colors for the native color input', () => {
    expect(hslTripletToHex('210 40% 98%')).toBe('#f8fafc');
    expect(hslTripletToHex('0 100% 50%')).toBe('#ff0000');
    expect(hslTripletToHex('invalid')).toBeNull();
  });
});

describe('pickPrimaryForeground', () => {
  it('uses dark text on light accents and light text on dark accents', () => {
    expect(pickPrimaryForeground('#fde047')).toBe('0 0% 0%');
    expect(pickPrimaryForeground('#16a34a')).toBe('0 0% 0%');
    expect(pickPrimaryForeground('#1e3a8a')).toBe('0 0% 100%');
    expect(pickPrimaryForeground('#777777')).toBe('0 0% 0%');
  });
});

describe('pickAccentEmphasis', () => {
  it('keeps a contrasting accent and replaces an invisible one for text and rings', () => {
    expect(pickAccentEmphasis('#2563eb', '0 0% 100%')).toBe('221.2 83.2% 53.3%');
    expect(pickAccentEmphasis('#16a34a', '0 0% 100%')).toMatch(/^142\.1 76\.2% (?!0%)\d+(?:\.\d+)?%$/);
    expect(pickAccentEmphasis('#ffffff', '0 0% 100%')).toBe('0 0% 46.5%');
    expect(pickAccentEmphasis('#000000', '222.2 84% 4.9%')).toBe('0 0% 47%');
  });
});

describe('themeTokenStyle', () => {
  it('asks for removal of every variable when everything is default', () => {
    expect(themeTokenStyle(DEFAULT_THEME_TOKENS)).toEqual({
      variables: {
        '--primary': null,
        '--primary-emphasis': null,
        '--ring': null,
        '--primary-foreground': null,
        '--radius': null,
      },
      fontScale: null,
      animation: 'normal',
    });
  });

  it('maps the accent to primary, ring and a readable foreground', () => {
    const style = themeTokenStyle({ ...DEFAULT_THEME_TOKENS, accentColor: '#2563eb' });
    expect(style.variables['--primary']).toBe('221.2 83.2% 53.3%');
    expect(style.variables['--primary-emphasis']).toBe('221.2 83.2% 53.3%');
    expect(style.variables['--ring']).toBe('221.2 83.2% 53.3%');
    expect(style.variables['--primary-foreground']).toBe('0 0% 100%');
  });

  it('uses separate contrast thresholds for accent text and focus rings', () => {
    const style = themeTokenStyle({ ...DEFAULT_THEME_TOKENS, accentColor: '#16a34a' });
    expect(style.variables['--primary-emphasis']).toMatch(/^142\.1 76\.2% (?!0%)\d+(?:\.\d+)?%$/);
    expect(style.variables['--ring']).toBe('142.1 76.2% 36.3%');
  });

  it('maps radius and font scale', () => {
    const style = themeTokenStyle({ ...DEFAULT_THEME_TOKENS, radius: 'none', fontScale: 1.25 });
    expect(style.variables['--radius']).toBe('0rem');
    expect(style.fontScale).toBe(1.25);
  });
});

describe('applyThemeTokens', () => {
  const root = () => document.createElement('div');

  it('writes inline variables, the root font size and the animation attribute', () => {
    const element = root();
    applyThemeTokens({ accentColor: '#2563eb', fontScale: 1.25, radius: 'large', animation: 'reduced' }, element);

    expect(element.style.getPropertyValue('--primary')).toBe('221.2 83.2% 53.3%');
    expect(element.style.getPropertyValue('--radius')).toBe('0.75rem');
    expect(element.style.fontSize).toBe('125%');
    expect(element.dataset.animation).toBe('reduced');
  });

  it('removes the inline overrides so the theme preset takes over again', () => {
    const element = root();
    applyThemeTokens({ accentColor: '#2563eb', fontScale: 1.25, radius: 'large', animation: 'reduced' }, element);
    applyThemeTokens(DEFAULT_THEME_TOKENS, element);

    expect(element.style.getPropertyValue('--primary')).toBe('');
    expect(element.style.getPropertyValue('--ring')).toBe('');
    expect(element.style.getPropertyValue('--primary-emphasis')).toBe('');
    expect(element.style.getPropertyValue('--primary-foreground')).toBe('');
    expect(element.style.getPropertyValue('--radius')).toBe('');
    expect(element.style.fontSize).toBe('');
    expect(element.dataset.animation).toBeUndefined();
  });
});
