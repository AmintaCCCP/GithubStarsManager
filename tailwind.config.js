import typography from '@tailwindcss/typography';
import animate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    screens: {
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1300px',
      '2xl': '1536px',
    },
    extend: {
      fontFamily: {
        // Theme presets may swap these via --font-sans/--font-serif/--font-mono.
        sans: ['var(--font-sans)'],
        serif: ['var(--font-serif)'],
        mono: ['var(--font-mono)'],
      },
      borderRadius: {
        // shadcn-style radius scale driven by --radius so themes control corner
        // rounding. Values coincide with Tailwind defaults at --radius: 0.5rem.
        md: 'calc(var(--radius) - 2px)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) + 4px)',
      },
      boxShadow: {
        // Elevation recipes are token-driven so themes can restyle shadows.
        'subtle': 'var(--app-shadow-subtle)',
        'ring': '0 0 0 1px hsl(var(--shadow-color) / 0.08)',
        'elevated': 'var(--app-shadow-elevated)',
        'dialog': 'var(--app-shadow-dialog)',
        'focus': '0 0 0 3px hsl(var(--ring) / 0.18)',
        'inset-panel': '0 1px 0 rgba(255,255,255,0.04) inset',
      },
      colors: {
        // shadcn semantic surfaces and compatibility aliases
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        'marketing-black': 'hsl(var(--background) / <alpha-value>)',
        'panel-dark': 'hsl(var(--card) / <alpha-value>)',
        'surface-3': 'hsl(var(--muted) / <alpha-value>)',
        'surface-sec': 'hsl(var(--accent) / <alpha-value>)',
        'text-primary': 'hsl(var(--foreground) / <alpha-value>)',
        'text-secondary': 'hsl(var(--muted-foreground) / <alpha-value>)',
        'text-tertiary': 'hsl(var(--muted-foreground) / <alpha-value>)',
        'text-quaternary': 'hsl(var(--muted-foreground) / 0.7)',
        brand: {
          indigo: 'hsl(var(--primary) / <alpha-value>)',
          violet: 'hsl(var(--accent-foreground) / <alpha-value>)',
          hover: 'hsl(var(--primary) / 0.9)',
        },
        'security-lavender': 'hsl(var(--accent-foreground) / <alpha-value>)',
        // Semantic status colors (theme-tunable via --success/--warning).
        success: 'hsl(var(--success) / <alpha-value>)',
        'success-foreground': 'hsl(0 0% 100% / <alpha-value>)',
        warning: 'hsl(var(--warning) / <alpha-value>)',
        'warning-foreground': 'hsl(0 0% 100% / <alpha-value>)',
        'status-green': 'hsl(var(--success) / <alpha-value>)',
        'status-emerald': 'hsl(var(--success) / <alpha-value>)',
        'status-amber': 'hsl(var(--warning) / <alpha-value>)',
        'status-red': 'hsl(var(--destructive) / <alpha-value>)',
        'border-primary': 'hsl(var(--border) / <alpha-value>)',
        'border-secondary': 'hsl(var(--border) / <alpha-value>)',
        'border-tertiary': 'hsl(var(--border) / <alpha-value>)',
        'line-tint': 'hsl(var(--muted) / <alpha-value>)',
        'line-tertiary': 'hsl(var(--border) / <alpha-value>)',
        'light-bg': 'hsl(var(--background) / <alpha-value>)',
        'light-surface': 'hsl(var(--muted) / <alpha-value>)',
        'light-border': 'hsl(var(--border) / <alpha-value>)',
        'light-border-alt': 'hsl(var(--border) / <alpha-value>)',
        // Legacy aliases intentionally resolve to the same semantic defaults.
        'primary-legacy': 'hsl(var(--primary) / <alpha-value>)',
        'secondary-legacy': 'hsl(var(--secondary) / <alpha-value>)',
        'accent-legacy': 'hsl(var(--accent) / <alpha-value>)'
      },
      fontWeight: {
        'light': '300',
        'normal': '400',
        'medium': '510',
        'semibold': '590',
      },
      letterSpacing: {
        'display-xl': '-1.584px',
        'display-lg': '-1.408px',
        'display': '-1.056px',
        'h1': '-0.704px',
        'h2': '-0.288px',
        'h3': '-0.24px',
        'body-lg': '-0.165px',
        'caption': '-0.13px',
        'tiny': '-0.15px',
      },
      boxShadow: {
        'subtle': '0 1px 2px rgba(0,0,0,0.035)',
        'ring': '0 0 0 1px rgba(0,0,0,0.08)',
        'elevated': '0 12px 32px rgba(0,0,0,0.12)',
        'dialog': '0 20px 48px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)',
        'focus': '0 0 0 3px rgba(94,106,210,0.18)',
        'inset-panel': '0 1px 0 rgba(255,255,255,0.04) inset',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'fade-out': 'fadeOut 0.15s ease-in forwards',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.3s ease-in forwards',
        'bounce-gentle': 'bounceGentle 2s ease-in-out infinite',
        'shake': 'shake 0.5s ease-in-out',
        'bounce-twice': 'bounceTwice 0.6s ease-in-out',
        'selection-exit': 'selectionExit 0.25s ease-out forwards',
        'expand-fade': 'expandFade 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideUp: {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(0)', opacity: '1' },
          '100%': { transform: 'translateY(100%)', opacity: '0' },
        },
        bounceGentle: {
          '0%, 20%, 50%, 80%, 100%': { transform: 'translateY(0)' },
          '40%': { transform: 'translateY(-4px)' },
          '60%': { transform: 'translateY(-2px)' },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '10%, 30%, 50%, 70%, 90%': { transform: 'translateX(-4px)' },
          '20%, 40%, 60%, 80%': { transform: 'translateX(4px)' },
        },
        bounceTwice: {
          '0%, 100%': { transform: 'translateY(0)' },
          '25%': { transform: 'translateY(-12px)' },
          '50%': { transform: 'translateY(0)' },
          '75%': { transform: 'translateY(-8px)' },
        },
        selectionExit: {
          '0%': { transform: 'scale(1)', boxShadow: '0 0 0 2px #3b82f6' },
          '50%': { transform: 'scale(1.01)', boxShadow: '0 0 0 3px #60a5fa' },
          '100%': { transform: 'scale(1)', boxShadow: '0 0 0 0 transparent' },
        },
        expandFade: {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      }
    },
  },
  plugins: [
    typography,
    animate,
  ],
};
