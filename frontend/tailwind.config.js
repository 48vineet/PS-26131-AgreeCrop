/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
        display: ['Sora', '"IBM Plex Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Primary agricultural palette - deep natural green
        crop: {
          50: '#F2F7EF',
          100: '#E3EEDC',
          200: '#C7DDB9',
          300: '#A3C793',
          400: '#7CAC6C',
          500: '#588F49',
          600: '#43733A',
          700: '#345C2E', // primary brand accent - "moss"
          800: '#294A25',
          900: '#1F381C',
        },
        // Secondary earth tone - used sparingly, never alongside crop in one view
        soil: {
          50: '#F8F4EC',
          100: '#EFE6D3',
          200: '#DFCBA6',
          300: '#CBAC78',
          400: '#B58E52',
          500: '#9C7239',
          600: '#7D5A2D', // "clay"
          700: '#5F4423',
          800: '#46311A',
          900: '#2E2011',
        },
        // Deliberately cool note - reserved for weather/water context only
        sky: {
          50: '#EFF6F8',
          100: '#DCEBF0',
          200: '#B7D6E1',
          300: '#8CBECE',
          400: '#5FA0B8',
          500: '#3F809A',
          600: '#326780',
          700: '#295266',
          800: '#1F3E4D',
          900: '#162B36',
        },
        // Warm-tinted neutrals (not cool gray) - backgrounds, borders, text
        neutral: {
          50: '#FAF8F4',  // canvas
          100: '#F3F0E9',
          200: '#E7E2D6', // mist / hairline borders
          300: '#D3CCBC',
          400: '#ADA593',
          500: '#83796A',
          600: '#635B4F',
          700: '#4A4339',
          800: '#322D26',
          900: '#211E19', // ink
        },
        // Semantic - used only when meaning requires it, desaturated not neon
        alert: {
          danger: '#AE4B42',
          warning: '#B8863B',
          success: '#43733A',
          info: '#326780',
        },
        // Semantic surface/action tokens used by the shared ui/ component
        // library (Card, Button, Badge, Alert, Modal, PageHeader, DataTable,
        // EmptyState, ErrorState, RiskIndicator, Select...). These alias the
        // brand palette above rather than introducing new colors, so every
        // component that references bg-primary/text-foreground/border-border
        // etc. actually resolves to the crop/soil/neutral/alert system
        // instead of silently generating no CSS.
        background: '#FAF8F4',
        foreground: '#211E19',
        card: '#FFFFFF',
        'card-foreground': '#211E19',
        popover: '#FFFFFF',
        'popover-foreground': '#211E19',
        primary: '#345C2E',
        'primary-foreground': '#FFFFFF',
        secondary: '#43733A',
        'secondary-foreground': '#FFFFFF',
        accent: '#B8863B',
        'accent-foreground': '#5F4423',
        muted: '#F3F0E9',
        'muted-foreground': '#635B4F',
        border: '#E7E2D6',
        input: '#E7E2D6',
        destructive: '#AE4B42',
        'destructive-foreground': '#FFFFFF',
      },
      borderRadius: {
        DEFAULT: '6px',
        sm: '6px',
        md: '10px',
        lg: '16px',
        xl: '20px',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(33,30,25,0.06), 0 1px 1px rgba(33,30,25,0.04)',
        md: '0 4px 12px rgba(33,30,25,0.08), 0 2px 4px rgba(33,30,25,0.04)',
        lg: '0 12px 32px rgba(33,30,25,0.12), 0 4px 8px rgba(33,30,25,0.06)',
      },
      ringColor: {
        DEFAULT: '#345C2E',
      },
    },
  },
  plugins: [],
}
