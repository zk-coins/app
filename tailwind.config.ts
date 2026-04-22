import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bitcoin: {
          DEFAULT: '#f7931a',
          dark: '#e8850f',
          light: '#f9a940',
        },
        zkcoins: {
          bg: '#0a0a0a',
          card: '#141414',
          border: '#1f1f1f',
          text: '#e5e5e5',
          muted: '#737373',
        },
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
