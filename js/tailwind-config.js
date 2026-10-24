// Split's colours and fonts, taken from the UI prototype (design/prototype.html).
// Loaded right after the Tailwind CDN script, so every page can use these classes.
tailwind.config = {
  theme: {
    extend: {
      colors: {
        terracotta: {
          50: '#FDF7F5', 100: '#FBECE8', 200: '#F7D4CC', 300: '#F1B2A3', 400: '#E9846E',
          500: '#E05638', 600: '#C73F22', 700: '#A12F18', 800: '#812816', 900: '#692416',
        },
        amberWarm: { 100: '#FEF3C7', 400: '#FBBF24', 500: '#F59E0B', 600: '#D97706', 800: '#92400E' },
        sage: { 50: '#ECFDF5', 100: '#D1FAE5', 300: '#6EE7B7', 400: '#34D399', 500: '#10B981', 600: '#059669', 800: '#065F46' },
        creamBg: '#FAF7F2',
        espresso: '#1F2937',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        display: ['Outfit', 'Inter', 'sans-serif'],
      },
      // The prototype used a few class names Tailwind v3 doesn't ship; these make them work.
      spacing: { 13: '3.25rem' },
      scale: { 98: '.98' },
      boxShadow: { xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)' },
      dropShadow: { xs: '0 1px 1px rgb(0 0 0 / 0.15)' },
      borderRadius: { xs: '0.125rem' },
      backdropBlur: { xs: '2px' },
      keyframes: {
        sheetIn: { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
      },
      animation: { 'sheet-in': 'sheetIn .22s ease-out', 'fade-in': 'fadeIn .15s ease-out' },
    },
  },
};
