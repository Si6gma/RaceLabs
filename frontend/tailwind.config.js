/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        motorsport: {
          black:    '#07090C',
          charcoal: '#0B0F15',
          dark:     '#11171F',
          panel:    '#0D1117',
          surface:  '#141B24',
          'surface-2': '#1B2430',
          border:   '#1E2834',
          'border-strong': '#2A3745',
          orange:   '#FF7A1A',
          cyan:     '#00D4FF',
          green:    '#00E85A',
          red:      '#FF2044',
          yellow:   '#FFD000',
          purple:   '#8855FF',
          blue:     '#1166FF',
          text:     '#E8EEF4',
          muted:    '#9AACBE',
          dim:      '#5F7183',
        },
        eng: {
          green:  '#00E85A',
          red:    '#FF2044',
          yellow: '#FFD000',
          cyan:   '#00D4FF',
          blue:   '#1166FF',
        },
      },
      fontFamily: {
        label: ['"Barlow Condensed"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        telemetry: ['"JetBrains Mono"', '"SF Mono"', 'monospace'],
      },
      boxShadow: {
        'panel':         '0 1px 4px rgba(0,0,0,0.7)',
        'panel-lg':      '0 2px 16px rgba(0,0,0,0.8)',
        'inset-orange':  'inset 2px 0 0 #FF7A1A',
        'inset-cyan':    'inset 0 1px 0 #00D4FF',
        'glow-green':    '0 0 8px rgba(0,232,90,0.4)',
        'glow-red':      '0 0 8px rgba(255,32,68,0.4)',
        'glow-cyan':     '0 0 8px rgba(0,212,255,0.4)',
      },
    },
  },
  plugins: [],
}
