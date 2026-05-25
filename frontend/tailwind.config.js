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
          black:    '#0d1117',
          charcoal: '#161b22',
          dark:     '#1c2433',
          panel:    '#161b22',
          surface:  '#1e2d3d',
          'surface-2': '#243347',
          border:   '#21303f',
          'border-strong': '#2d3f52',
          orange:   '#f97316',
          cyan:     '#06b6d4',
          green:    '#22c55e',
          red:      '#ef4444',
          yellow:   '#eab308',
          purple:   '#a855f7',
          blue:     '#3b82f6',
          text:     '#cdd9e5',
          muted:    '#768390',
          dim:      '#444c56',
        },
        // Semantic engineering palette — strict colour semantics
        eng: {
          green:  '#00FF88', // gain time, optimal, healthy
          red:    '#FF3333', // losing time, critical, overheat
          yellow: '#FFCC00', // warning, degradation approaching
          cyan:   '#00E5FF', // neutral telemetry, structural accents
          blue:   '#0057FF', // baseline reference, ERS harvest
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'monospace'],
        telemetry: ['"JetBrains Mono"', '"SF Mono"', 'monospace'],
      },
      boxShadow: {
        'panel': '0 1px 2px rgba(0,0,0,0.4)',
        'panel-lg': '0 2px 8px rgba(0,0,0,0.5)',
        'inset-orange': 'inset 2px 0 0 #f97316',
      },
    },
  },
  plugins: [],
}
