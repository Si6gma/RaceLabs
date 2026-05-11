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
          black:    '#020617',
          charcoal: '#0c1322',
          dark:     '#0f172a',
          panel:    '#131d2e',
          surface:  '#1e293b',
          'surface-2': '#243347',
          border:   '#2a3a52',
          'border-strong': '#334155',
          orange:   '#f97316',
          cyan:     '#06b6d4',
          green:    '#22c55e',
          red:      '#ef4444',
          yellow:   '#eab308',
          purple:   '#a855f7',
          blue:     '#3b82f6',
          text:     '#e2e8f0',
          muted:    '#94a3b8',
          dim:      '#475569',
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
