import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Just three brand colors plus a few neutrals.
        bg: '#000000',
        ink: '#ffffff',
        ink2: '#a1a1aa',
        ink3: '#71717a',
        ink4: '#3f3f46',
        line: '#1c1c1c',
        line2: '#262626',
        surface: '#0c0c0c',
        bitcoin: {
          DEFAULT: '#f7931a',
          hover: '#ff9f2a',
          dim: '#c9761a',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
        pixel: ['var(--font-pixel)', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      animation: {
        'caret-blink': 'caret-blink 1s steps(2) infinite',
        'fade-in': 'fade-in 0.3s ease-out',
        'pixel-pulse': 'pixel-pulse 2s ease-in-out infinite',
      },
      keyframes: {
        'caret-blink': {
          '0%, 50%': { opacity: '1' },
          '51%, 100%': { opacity: '0' },
        },
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pixel-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.6' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
