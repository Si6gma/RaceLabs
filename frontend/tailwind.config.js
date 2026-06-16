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
          black:    '#060A0F',
          charcoal: '#0A0F16',
          dark:     '#0E1620',
          panel:    '#0A0F16',
          surface:  '#111922',
          'surface-2': '#182333',
          border:   '#1A2840',
          'border-strong': '#243856',
          orange:   '#FF7700',
          cyan:     '#00D4FF',
          green:    '#00E85A',
          red:      '#FF2044',
          yellow:   '#FFD000',
          purple:   '#8855FF',
          blue:     '#1166FF',
          text:     '#B8C8D6',
          muted:    '#4A6078',
          dim:      '#243546',
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
        'inset-orange':  'inset 2px 0 0 #FF7700',
        'inset-cyan':    'inset 0 1px 0 #00D4FF',
        'glow-green':    '0 0 8px rgba(0,232,90,0.4)',
        'glow-red':      '0 0 8px rgba(255,32,68,0.4)',
        'glow-cyan':     '0 0 8px rgba(0,212,255,0.4)',
      },
    },
  },
  plugins: [],
}
