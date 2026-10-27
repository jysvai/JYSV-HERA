import './fonts.css'
import './styles.css'

import { createRoot } from 'react-dom/client'

import { App } from './app/App'
import { bootStore } from './store/app'
import { restoreCachedTheme } from './store/theme'

// Paint the last theme before the config round-trip to avoid a flash.
restoreCachedTheme()

const root = createRoot(document.getElementById('root')!)

// Windows Terminal's font ships with HERA. xterm measures its cell once, when a
// terminal opens: measured on a fallback font while the real one still loads,
// every row is laid out on the wrong grid.
function fontsReady(): Promise<unknown> {
  const fonts = ['13px "Cascadia Mono"', 'bold 13px "Cascadia Mono"'].map(font => document.fonts.load(font).catch(() => undefined))

  return Promise.race([Promise.all(fonts), new Promise(resolve => setTimeout(resolve, 1500))])
}

Promise.all([bootStore(), fontsReady()])
  .then(() => root.render(<App />))
  .catch(error => {
    root.render(
      <div style={{ padding: 24, fontFamily: 'monospace', color: '#f0625a' }}>
        HERA 를 시작하지 못했습니다: {String(error?.message || error)}
      </div>
    )
  })
