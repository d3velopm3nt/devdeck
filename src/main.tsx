import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './index.css'
import App from './App.tsx'
import { CommandWidget } from './widget/CommandWidget'
import { CaptureToast } from './widget/CaptureToast'
import { ErrorBoundary } from './ErrorBoundary'

// The same bundle serves every window; the window label selects the UI.
let label = 'main'
try {
  label = getCurrentWindow().label
} catch {
  label = 'main'
}

// The toast floats over other apps, so its page must not paint a background
// behind the card (see index.css).
if (label === 'toast') document.documentElement.dataset.window = 'toast'

const ui =
  label === 'widget' ? <CommandWidget /> : label === 'toast' ? <CaptureToast /> : <App />

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>{ui}</ErrorBoundary>
  </StrictMode>,
)
