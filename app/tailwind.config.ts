import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        fg: 'var(--fg)',
        muted: 'var(--muted)',
        border: 'var(--border)',
        accent: 'var(--accent)',
        'accent-fg': 'var(--accent-fg)',
        success: 'var(--success)',
        'success-fg': 'var(--success-fg)',
        warning: 'var(--warning)',
        'warning-fg': 'var(--warning-fg)',
        danger: 'var(--danger)',
        'danger-fg': 'var(--danger-fg)',
        pending: 'var(--pending)',
        'pending-fg': 'var(--pending-fg)',
      },
      fontFamily: {
        sans: ['var(--font-ui)'],
        display: ['var(--font-display)'],
        mono: ['var(--font-mono)'],
      },
      fontSize: {
        display: ['var(--text-display)', { lineHeight: '1.02', letterSpacing: '-0.045em' }],
        headline: ['var(--text-headline)', { lineHeight: '1.08', letterSpacing: '-0.03em' }],
        title: ['var(--text-title)', { lineHeight: '1.18', letterSpacing: '-0.02em' }],
        body: ['var(--text-body)', { lineHeight: '1.6' }],
        small: ['var(--text-small)', { lineHeight: '1.5' }],
        micro: ['var(--text-micro)', { lineHeight: '1.4', letterSpacing: '0.08em' }],
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        panel: 'var(--shadow-panel)',
        lift: 'var(--shadow-lift)',
      },
      transitionDuration: {
        fast: 'var(--motion-fast)',
        base: 'var(--motion-base)',
      },
      keyframes: {
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'spin-slow': 'spin-slow 900ms linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
