/** OLED-палитра: чёрный фон, нигде нет чистого белого (#FFFFFF), только грязно-белый. */
module.exports = {
  content: ['./renderer/**/*.{html,js}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      black: '#000000',
      white: '#FFFFFF',
      ink: '#E4E4E2',
      dim: '#8A8A88',
      mute: '#5A5A58',
      line: '#1C1C1C',
      line2: '#2A2A2C',
      panel: '#0A0A0B',
      raise: '#121214',
      tile: '#18181B',
      soft: '#D2D2D0',
      softer: '#B9B9B7',
      abort: '#FF3434',
      accent: 'rgb(var(--accent) / <alpha-value>)',
      ok: '#34D399',
      warn: '#FACC15',
      bad: '#EF4444'
    },
    ringOffsetColor: ({ theme }) => ({ ...theme('colors'), DEFAULT: '#000000' }),
    ringColor: ({ theme }) => ({ ...theme('colors'), DEFAULT: '#2A2A2A' }),
    extend: {
      fontFamily: {
        sans: ['Montserrat', 'Segoe UI', 'system-ui', 'sans-serif'],
        pixel: ['Minecraft Five', 'Silkscreen', 'monospace']
      }
    }
  },
  plugins: []
};
