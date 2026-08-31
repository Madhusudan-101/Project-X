/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Dark theme palette
        dark: {
          900: '#050508',
          800: '#0d0d14',
          700: '#12121e',
          600: '#1a1a2e',
          500: '#22223f',
          400: '#2d2d52',
        },
        accent: {
          purple: '#7c3aed',
          'purple-light': '#a78bfa',
          blue: '#2563eb',
          'blue-light': '#60a5fa',
          cyan: '#06b6d4',
          green: '#10b981',
          red: '#ef4444',
          orange: '#f59e0b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backdropBlur: {
        xs: '2px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-in-out',
        'slide-up': 'slideUp 0.4s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'bounce-gentle': 'bounceGentle 2s ease-in-out infinite',
        'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(100%)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        bounceGentle: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        glow: {
          '0%': { boxShadow: '0 0 20px rgba(124, 58, 237, 0.3)' },
          '100%': { boxShadow: '0 0 40px rgba(124, 58, 237, 0.7)' },
        },
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0, 0, 0, 0.4)',
        glow: '0 0 30px rgba(124, 58, 237, 0.4)',
        'glow-cyan': '0 0 30px rgba(6, 182, 212, 0.4)',
        'glow-red': '0 0 20px rgba(239, 68, 68, 0.4)',
        'glow-green': '0 0 20px rgba(16, 185, 129, 0.4)',
      },
    },
  },
  plugins: [],
};
