import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
// Bundled, not from Google Fonts: nothing on the way to the first frame waits on the network.
import '@fontsource-variable/source-serif-4'
import './tokens.css'
import './styles.css'

const root = document.getElementById('root')
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
