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
          black: '#0a0a0a',
          charcoal: '#141414',
          dark: '#1a1a1a',
          panel: '#1e1e1e',
          surface: '#242424',
          border: '#2a2a2a',
          orange: '#ff6b00',
          cyan: '#00e5ff',
          green: '#00e676',
          red: '#ff1744',
          yellow: '#ffea00',
          purple: '#d500f9',
          blue: '#3b82f6',
          text: '#e0e0e0',
          muted: '#888888',
          dim: '#555555',
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'monospace'],
        telemetry: ['"JetBrains Mono"', '"SF Mono"', 'monospace'],
      },
    },
  },
  plugins: [],
}
