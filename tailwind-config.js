tailwind.config = {
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#050c1f',
          900: '#0a1836',
          850: '#0e2047',
          800: '#132a5c',
          700: '#1c3a7a',
          600: '#274c9c',
        },
        // Sky blue: the site's dark-panel color (nav, hero, footer, coverage,
        // dark cards). Kept saturated/dark enough at 900-950 to host white
        // text, but a true blue rather than near-black navy.
        sky: {
          950: '#0b4a86',
          900: '#0f5da3',
          850: '#136fb9',
          800: '#1a82cc',
          700: '#2996dd',
          600: '#3ea9e8',
          500: '#5cbdf0',
        },
        brand: {
          700: '#1a3fc4',
          600: '#2450dd',
          500: '#3762f0',
          400: '#5c82f7',
          300: '#8ba5fb',
          100: '#e8edfe',
          50: '#f4f6ff',
        },
        alert: {
          600: '#c81733',
          500: '#e2233f',
          100: '#fde5e9',
        },
        ok: {
          700: '#0f6e4d',
          600: '#128a5e',
          100: '#e1f5ec',
        },
        steel: {
          300: '#c7d0e0',
          200: '#dde3ef',
        }
      },
      fontFamily: {
        display: ['Oswald', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
      },
      boxShadow: {
        elevated: '0 1px 1px rgba(10,24,54,0.04), 0 8px 16px -6px rgba(36,80,221,0.18), 0 20px 32px -16px rgba(10,24,54,0.28)',
        floating: '0 2px 2px rgba(10,24,54,0.05), 0 16px 32px -8px rgba(36,80,221,0.24), 0 32px 64px -20px rgba(5,12,31,0.45)',
        plate: '0 1px 0 rgba(255,255,255,0.6) inset, 0 2px 4px rgba(10,24,54,0.08), 0 12px 24px -10px rgba(10,24,54,0.25)',
      },
    }
  }
}
