import typography from '@tailwindcss/typography';

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
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', 'sans-serif'],
        mono: ['Berkeley Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      colors: {
        // Linear Base Backgrounds
        'marketing-black': '#08090a', 
        'panel-dark': '#0f1011',
        'surface-3': '#191a1b',
        'surface-sec': '#28282c',
        
        // Linear Text
        'text-primary': '#f7f8f8',
        'text-secondary': '#d0d6e0',
        'text-tertiary': '#8a8f98',
        'text-quaternary': '#62666d',
        
        // Linear Brand & Accent
        'brand-indigo': '#5e6ad2',
        'brand-violet': '#7170ff',
        'brand-hover': '#828fff',
        'security-lavender': '#7a7fad',
        
        // Linear Status
        'status-green': '#27a644',
        'status-emerald': '#10b981',
        'status-red': '#ef4444',
        
        // Linear Borders (Solid fallbacks, though we mainly use rgba)
        'border-primary': '#23252a',
        'border-secondary': '#34343a',
        'border-tertiary': '#3e3e44',
        'line-tint': '#141516',
        'line-tertiary': '#18191a',
        
        // Linear Light Mode Neutrals (Fallbacks if needed)
        'light-bg': '#f7f8f8',
        'light-surface': '#f3f4f5',
        'light-border': '#d0d6e0',
        'light-border-alt': '#e6e6e6',

        // Keeping existing for gradual migration
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#0066CC',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        secondary: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
        accent: {
          50: '#fefbf0',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        }
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
        'subtle': '0px 1.2px 0px rgba(0,0,0,0.03)',
        'ring': '0px 0px 0px 1px rgba(0,0,0,0.2)',
        'elevated': '0px 2px 4px rgba(0,0,0,0.4)',
        'dialog': '0px 8px 2px rgba(0,0,0,0), 0px 5px 2px rgba(0,0,0,0.01), 0px 3px 2px rgba(0,0,0,0.04), 0px 1px 1px rgba(0,0,0,0.07), 0px 0px 1px rgba(0,0,0,0.08)',
        'focus': '0px 4px 12px rgba(0,0,0,0.1)',
        'inset-panel': '0px 0px 12px 0px rgba(0,0,0,0.2) inset',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
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
  ],
};
