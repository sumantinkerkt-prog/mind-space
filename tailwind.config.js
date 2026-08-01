/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Animation timing function extensions
      transitionTimingFunction: {
        'out-smooth': 'cubic-bezier(0.32, 0.72, 0, 1)',
        'in-fast': 'cubic-bezier(0.36, 0, 0.66, -0.56)',
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      // Duration extensions
      transitionDuration: {
        '50': '50ms',
        '150': '150ms',
        '200': '200ms',
        '250': '250ms',
        '300': '300ms',
      },
    },
  },
  plugins: [],
}
