import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * Tailwind maps onto the tokens in src/styles/tokens.css — it does not define
 * its own palette. Everything resolves through CSS custom properties, which is
 * what lets the accent swap at runtime via `data-accent` on <html> without a
 * rebuild.
 *
 * The stock Tailwind palette is deliberately NOT extended. If `bg-blue-500` is
 * reachable, someone will reach for it, and the restraint that makes this look
 * considered evaporates one utility class at a time.
 */
const hsl = (v: string) => `hsl(var(${v}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    // `colors` REPLACES rather than extends: only our palette exists.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',

      paper: {
        DEFAULT: hsl('--paper'),
        raised: hsl('--paper-raised'),
        sunken: hsl('--paper-sunken'),
      },
      ink: {
        DEFAULT: hsl('--ink'),
        muted: hsl('--ink-muted'),
        subtle: hsl('--ink-subtle'),
        faint: hsl('--ink-faint'),
      },
      line: {
        DEFAULT: hsl('--line'),
        strong: hsl('--line-strong'),
      },
      accent: {
        DEFAULT: hsl('--accent'),
        hover: hsl('--accent-hover'),
        active: hsl('--accent-active'),
        soft: hsl('--accent-soft'),
        contrast: hsl('--accent-contrast'),
      },
      danger: { DEFAULT: hsl('--danger'), soft: hsl('--danger-soft') },
      success: { DEFAULT: hsl('--success'), soft: hsl('--success-soft') },
      warning: { DEFAULT: hsl('--warning'), soft: hsl('--warning-soft') },
    },

    // 8px grid.
    spacing: {
      0: '0',
      hair: 'var(--space-hair)',
      tight: 'var(--space-tight)',
      snug: 'var(--space-snug)',
      base: 'var(--space-base)',
      roomy: 'var(--space-roomy)',
      loose: 'var(--space-loose)',
      section: 'var(--space-section)',
      page: 'var(--space-page)',
      px: '1px',
      // Numeric steps for grid/flex gaps that need finer control.
      1: '0.25rem',
      2: '0.5rem',
      3: '0.75rem',
      4: '1rem',
      5: '1.25rem',
      6: '1.5rem',
      8: '2rem',
      10: '2.5rem',
      12: '3rem',
      16: '4rem',
      20: '5rem',
      24: '6rem',
      32: '8rem',
    },

    extend: {
      fontFamily: {
        display: 'var(--font-display)',
        sans: 'var(--font-ui)',
        mono: 'var(--font-mono)',
      },

      /**
       * Type scale. Display sizes are for the serif and are set tight with a
       * touch of negative tracking — large serif text set loose looks limp.
       * Body sizes are generous in leading for readability.
       */
      fontSize: {
        'display-xl': ['3.75rem', { lineHeight: '1.02', letterSpacing: '-0.022em' }],
        'display-lg': ['2.75rem', { lineHeight: '1.06', letterSpacing: '-0.018em' }],
        'display-md': ['2rem', { lineHeight: '1.12', letterSpacing: '-0.014em' }],
        'display-sm': ['1.5rem', { lineHeight: '1.2', letterSpacing: '-0.01em' }],
        lead: ['1.125rem', { lineHeight: '1.65' }],
        body: ['0.9375rem', { lineHeight: '1.6' }],
        sm: ['0.875rem', { lineHeight: '1.5' }],
        xs: ['0.8125rem', { lineHeight: '1.45' }],
        // Small caps-ish label style used for section eyebrows.
        label: ['0.6875rem', { lineHeight: '1.4', letterSpacing: '0.08em' }],
      },

      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
        full: '9999px',
      },

      boxShadow: {
        none: 'var(--shadow-none)',
        float: 'var(--shadow-float)',
        overlay: 'var(--shadow-overlay)',
      },

      maxWidth: {
        measure: 'var(--measure)',
        page: 'var(--page-max)',
      },

      transitionTimingFunction: { DEFAULT: 'var(--ease)', ease: 'var(--ease)' },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        DEFAULT: 'var(--duration)',
        slow: 'var(--duration-slow)',
      },

      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-in': 'fade-in var(--duration) var(--ease)',
        'rise-in': 'rise-in var(--duration) var(--ease)',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
