import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#08090d',
          subtle: '#10151b',
          panel: '#12171d',
          border: '#25303a',
        },
        accent: {
          DEFAULT: '#2dd4bf',
          green: '#10b981',
          amber: '#f59e0b',
          red: '#f43f5e',
          cyan: '#38bdf8',
          violet: '#a78bfa',
          blue: '#60a5fa',
          pink: '#fb7185',
        },
        fg: {
          DEFAULT: '#edf2f7',
          muted: '#98a4b3',
          subtle: '#647181',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 18px 60px rgba(0,0,0,0.28)',
        glow: '0 0 28px rgba(45,212,191,0.22)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
export default config;
