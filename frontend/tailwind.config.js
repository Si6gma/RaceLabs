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
          black:    '#080808',
          charcoal: '#111111',
          dark:     '#161616',
          panel:    '#1c1c1c',
          surface:  '#242424',
          'surface-2': '#2a2a2a',
          border:   '#343434',
          'border-strong': '#444444',
          orange:   '#ff6600',
          cyan:     '#00e5ff',
          green:    '#00e676',
          red:      '#ff1744',
          yellow:   '#ffea00',
          purple:   '#d500f9',
          blue:     '#3b82f6',
          text:     '#e2e2e2',
          muted:    '#808080',
          dim:      '#4a4a4a',
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'monospace'],
        telemetry: ['"JetBrains Mono"', '"SF Mono"', 'monospace'],
      },
      boxShadow: {
        'panel': '0 1px 3px rgba(0,0,0,0.5), 0 1px 2px rgba(0,0,0,0.3)',
        'panel-lg': '0 4px 12px rgba(0,0,0,0.6), 0 2px 4px rgba(0,0,0,0.4)',
        'inset-orange': 'inset 2px 0 0 #ff6600',
      },
    },
  },
  plugins: [],
}
