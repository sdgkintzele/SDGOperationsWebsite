/** @type {import('tailwindcss').Config} */
const defaultTheme = require('tailwindcss/defaultTheme');

module.exports = {
  darkMode: 'class',

  // Files Tailwind should scan for class names
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],

  theme: {
    container: { center: true, padding: { DEFAULT: '1rem', lg: '2rem' } },
    extend: {
      /* --- Brand / UI colors --- */
      colors: {
        sdg: {
          charcoal: '#2B2F33',
          dark: '#3A4147',
          slate: '#6B7280',
          bronze: '#B4835B',
          sand: '#D0A777',
          paper: '#F7F7F5',
        },
      },

      /* --- Typography --- */
      fontFamily: {
        sans: ['Inter', ...defaultTheme.fontFamily.sans],
        heading: ['"League Spartan"', 'Inter', ...defaultTheme.fontFamily.sans],
      },

      /* --- Visual polish --- */
      backgroundImage: {
        'sdg-gold': 'linear-gradient(90deg, #B4835B 0%, #D0A777 100%)',
      },
      boxShadow: {
        soft: '0 2px 12px rgba(0,0,0,0.06)',
        card: '0 1px 1px rgb(0 0 0 / 0.04), 0 2px 4px rgb(0 0 0 / 0.06)',
      },
      borderRadius: { '2xl': '1rem' },
    },
  },

  plugins: [require('@tailwindcss/forms')],
};
