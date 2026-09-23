import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './index.css'
import App from './App.tsx'
import { CommandWidget } from './widget/CommandWidget'
import { CaptureToast } from './widget/CaptureToast'
import { Splash } from './widget/Splash'
import { ErrorBoundary } from './ErrorBoundary'

// The same bundle serves every window; the window label selects the UI.
let label = 'main'
try {
  label = getCurrentWindow().label
} catch {
  label = 'main'
}

// The toast and splash windows float undecorated and transparent, so their
// page must not paint a background behind the card (see index.css).
if (label === 'toast' || label === 'splash') document.documentElement.dataset.window = label

const ui =
  label === 'widget' ? (
    <CommandWidget />
  ) : label === 'toast' ? (
    <CaptureToast />
  ) : label === 'splash' ? (
    <Splash />
  ) : (
    <App />
  )

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>{ui}</ErrorBoundary>
  </StrictMode>,
)
// capture 1789948489
