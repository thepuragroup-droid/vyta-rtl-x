import type { Config } from 'tailwindcss';

/**
 * VYTA Biosciences design tokens.
 *
 * Sourced from the Brand Identity Guidelines v1.0 (Sept 2026). Midnight Navy
 * is the anchor — it is the text/ink colour as well as the darkest surface.
 * Bio Teal and Aqua carry vitality (accents, focus, interactive state); Mist
 * and Cloud create the breathing room the guidelines ask for.
 *
 * The six core swatches are exact brand values and must not be altered:
 *   Midnight Navy #07203A · Deep Ocean #0E3F5F · Vital Blue  #1B5D83
 *   Bio Teal      #438B9E · Aqua        #6EB2B8 · Mist       #BBD6D6
 *
 * Everything else here (tints, Cloud, line, ink-muted) is a derived ramp built
 * to hit WCAG AA against the surfaces it is actually used on.
 */
const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './contexts/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Core brand swatches ──────────────────────────────────────────
        navy: {
          DEFAULT: '#07203A', // Midnight Navy — the anchor
          light: '#0A2F4D',
          800: '#0A2F4D',
          900: '#07203A',
        },
        ocean: '#0E3F5F', // Deep Ocean
        vital: '#1B5D83', // Vital Blue
        aqua: '#6EB2B8', // Aqua
        mist: '#BBD6D6', // Mist
        cloud: '#F7FAFB', // Cloud — the page ground

        /**
         * Bio Teal, the interactive accent. Scaled so the shades the UI leans
         * on stay legible: `teal` (#438B9E) is AA on white for large text and
         * UI chrome, `teal-dark` (Vital Blue) is AA for body-size text.
         */
        teal: {
          DEFAULT: '#438B9E',
          light: '#6EB2B8', // Aqua
          dark: '#1B5D83', // Vital Blue
          50: '#F1F8F9',
          100: '#E1EFF1',
          200: '#C4DFE3',
          300: '#9CCBD1',
          400: '#6EB2B8',
          500: '#438B9E',
          600: '#1B5D83',
          700: '#0E3F5F',
          800: '#07203A',
          900: '#05182B',
        },

        // ── Semantic surface / text roles ────────────────────────────────
        ink: {
          DEFAULT: '#07203A', // Midnight Navy
          muted: '#56707F',
          light: '#6E8898',
        },
        surface: {
          DEFAULT: '#F7FAFB', // Cloud
          2: '#EDF3F5',
        },
        line: '#DCE7EB',

        // Kept so existing `primary-*` / `accent-*` usages resolve to the
        // brand ramp rather than disappearing.
        primary: {
          50: '#F1F8F9',
          100: '#E1EFF1',
          200: '#C4DFE3',
          300: '#9CCBD1',
          400: '#6EB2B8',
          500: '#438B9E',
          600: '#1B5D83',
          700: '#0E3F5F',
          800: '#07203A',
          900: '#05182B',
        },
        accent: {
          50: '#F1F8F9',
          100: '#E1EFF1',
          200: '#C4DFE3',
          300: '#9CCBD1',
          400: '#6EB2B8',
          500: '#438B9E',
          600: '#1B5D83',
          700: '#0E3F5F',
          800: '#07203A',
          900: '#05182B',
        },
      },
      fontFamily: {
        // Inter for body copy, UI, specifications and long-form text.
        sans: ['var(--font-inter)', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'sans-serif'],
        // Inter Display for headings / product names / campaigns. Same family,
        // driven to the display optical size by `.font-display` in globals.css.
        display: ['var(--font-inter)', 'Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      backgroundImage: {
        // Soft gradients — a design-language staple. Mirrors the navy→teal
        // sweep used on the guideline sheet's rules and the logo mark.
        'brand-gradient': 'linear-gradient(135deg, #07203A 0%, #0E3F5F 45%, #438B9E 100%)',
        'brand-gradient-soft': 'linear-gradient(135deg, #F1F8F9 0%, #E1EFF1 50%, #FFFFFF 100%)',
        'brand-rule': 'linear-gradient(90deg, #07203A 0%, #1B5D83 50%, #6EB2B8 100%)',
      },
      boxShadow: {
        // Calm, navy-tinted elevation — no neutral grey drop shadows.
        card: '0 1px 2px rgba(7, 32, 58, 0.04), 0 8px 24px -12px rgba(7, 32, 58, 0.10)',
        'card-hover': '0 2px 4px rgba(7, 32, 58, 0.05), 0 16px 40px -16px rgba(7, 32, 58, 0.16)',
        focus: '0 0 0 3px rgba(67, 139, 158, 0.28)',
      },
      borderRadius: {
        // Clean geometry: slightly softer than stock, consistent across cards.
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      animation: {
        'fade-in': 'fadeIn 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        'slide-up': 'slideUp 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(30px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
};
export default config;
