/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0F0F0F',
        surface: '#1A1A1A',
        elevated: '#242424',
        line: '#2E2E2E',
        muted: '#8A8A8A',
        accent: '#F0653A',
        'accent-dim': '#C24E2C',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      keyframes: {
        pop: {
          '0%': { transform: 'scale(1)' },
          '40%': { transform: 'scale(1.3)' },
          '100%': { transform: 'scale(1)' },
        },
        fade: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        rise: {
          '0%': { transform: 'translateY(16px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        pop: 'pop 250ms ease-out',
        fade: 'fade 160ms ease-out',
        rise: 'rise 200ms cubic-bezier(.2,.8,.2,1)',
      },
    },
  },
  plugins: [],
};
