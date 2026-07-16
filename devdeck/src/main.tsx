import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './index.css'
import App from './App.tsx'
import { CommandWidget } from './widget/CommandWidget'

// The same bundle serves both windows; the window label selects the UI.
let isWidget = false
try {
  isWidget = getCurrentWindow().label === 'widget'
} catch {
  isWidget = false
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isWidget ? <CommandWidget /> : <App />}</StrictMode>,
)
