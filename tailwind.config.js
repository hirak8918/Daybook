/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /* Every colour resolves through a CSS variable so the light "paper" and
         dark "night" editions share one set of utility classes. */
      colors: {
        paper: {
          DEFAULT: 'rgb(var(--paper) / <alpha-value>)',
          deep: 'rgb(var(--paper-deep) / <alpha-value>)',
          raise: 'rgb(var(--paper-raise) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          soft: 'rgb(var(--ink-soft) / <alpha-value>)',
          mute: 'rgb(var(--ink-mute) / <alpha-value>)',
          faint: 'rgb(var(--ink-faint) / <alpha-value>)',
        },
        rule: {
          DEFAULT: 'rgb(var(--rule) / <alpha-value>)',
          strong: 'rgb(var(--rule-strong) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          deep: 'rgb(var(--accent-deep) / <alpha-value>)',
          wash: 'rgb(var(--accent-wash) / <alpha-value>)',
          ink: 'rgb(var(--accent-ink) / <alpha-value>)',
        },
        ochre: 'rgb(var(--ochre) / <alpha-value>)',
        olive: 'rgb(var(--olive) / <alpha-value>)',
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'Times New Roman', 'serif'],
        text: ['Geist', 'Verdana', 'Tahoma', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'Courier New', 'monospace'],
      },
      /* Nothing below 12px ships: labels are mono 12px, body is 14–15px. */
      fontSize: {
        label: ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.14em' }],
        micro: ['0.75rem', { lineHeight: '1.1rem', letterSpacing: '0.02em' }],
        small: ['0.875rem', { lineHeight: '1.4' }],
        body: ['0.9375rem', { lineHeight: '1.5' }],
        lede: ['1rem', { lineHeight: '1.55' }],
        word: ['1.125rem', { lineHeight: '1', letterSpacing: '-0.01em' }],
        page: ['1.75rem', { lineHeight: '1.1', letterSpacing: '-0.015em' }],
        head: ['2rem', { lineHeight: '1.05', letterSpacing: '-0.02em' }],
        /* Display numbers: 48 → 72px, fluid. */
        metric: ['clamp(3rem, 4.6vw, 4.5rem)', { lineHeight: '0.95', letterSpacing: '-0.035em' }],
        clock: ['clamp(3.25rem, 6.5vw, 5.5rem)', { lineHeight: '0.9', letterSpacing: '-0.03em' }],
      },
      spacing: {
        bar: '3rem',
        gutter: '1.5rem',
      },
      borderRadius: {
        none: '0',
        stamp: '2px',
      },
      boxShadow: {
        /* Hard offsets only — depth comes from rules and overlap. */
        offset: '3px 3px 0 0 rgb(var(--ink) / 1)',
        'offset-sm': '2px 2px 0 0 rgb(var(--ink) / 1)',
      },
      transitionTimingFunction: {
        press: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
        editorial: 'cubic-bezier(0.16, 0.84, 0.44, 1)',
      },
      keyframes: {
        'rule-draw': {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(0.5rem)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'ink-strike': {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
        'slide-in': {
          '0%': { opacity: '0', transform: 'translateX(-0.75rem)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'saved-flash': {
          '0%': { opacity: '0' },
          '15%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
      },
      animation: {
        'rule-draw': 'rule-draw 420ms cubic-bezier(0.16, 0.84, 0.44, 1) both',
        'fade-up': 'fade-up 320ms cubic-bezier(0.16, 0.84, 0.44, 1) both',
        'saved-flash': 'saved-flash 1400ms ease-out both',
      },
    },
  },
  plugins: [],
};
