// Split's colours and fonts. The colours are the sunflower palette: sage green #9DBBAA, sunflower orange #F28B37,
// burnt orange #CF5F22, rust red #A43527 and dark brown #341D1C on a warm off-white. Text and button shades are
// deepened so white or coloured text on them passes WCAG AA (4.5:1); the bright orange is kept for accents.
// Loaded right after the Tailwind CDN script, so every page can use these classes.
tailwind.config = {
  theme: {
    extend: {
      colors: {
        // Burnt orange -> rust. 500+ carry white text; 600/700 are the text shades.
        terracotta: {
          50: '#FDF3EC', 100: '#FAE3D3', 200: '#F3C4A5', 300: '#E89A6B', 400: '#CF5F22',
          500: '#B54C1B', 600: '#AA4221', 700: '#A43527', 800: '#7E2A1F', 900: '#561D17',
        },
        // Sunflower orange. 500 is the bright accent; 600 is deep enough for white text and text on white.
        amberWarm: { 100: '#FDEBD3', 400: '#F6A65A', 500: '#F28B37', 600: '#985A12', 800: '#723A10' },
        sage: { 50: '#F1F6F3', 100: '#DFEBE4', 300: '#B9D0C3', 400: '#9DBBAA', 500: '#4C7A62', 600: '#3D6851', 800: '#284534' },
        // Warm greys so muted text reads as brown-grey, and dark enough to read (500 is 6.4:1 on white).
        gray: {
          50: '#FAF6F1', 100: '#F3ECE4', 200: '#E7DDD2', 300: '#CFC2B6', 400: '#8F7F74',
          500: '#6B5C53', 600: '#594B43', 700: '#45372F', 800: '#2F2420', 900: '#221A17',
        },
        creamBg: '#FAF4EA',
        espresso: '#341D1C',
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
