import './styles.css'

import { createRoot } from 'react-dom/client'

import { App } from './app/App'
import { bootStore } from './store/app'
import { restoreCachedTheme } from './store/theme'

// Paint the last theme before the config round-trip to avoid a flash.
restoreCachedTheme()

const root = createRoot(document.getElementById('root')!)

bootStore()
  .then(() => root.render(<App />))
  .catch(error => {
    root.render(
      <div style={{ padding: 24, fontFamily: 'monospace', color: '#f0625a' }}>
        HERA 를 시작하지 못했습니다: {String(error?.message || error)}
      </div>
    )
  })
