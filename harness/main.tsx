// Renders the real DevDeck shell against the mocked IPC boundary, so the mail
// screens can be driven and photographed in a plain browser. Everything below
// `invoke` is production code.

import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import App from '../src/App'
import { useApp } from '../src/store'

// Which screen to open is a query param, so one bundle serves every shot.
const params = new URLSearchParams(location.search)
const view = params.get('view') ?? 'mail'
const pane = params.get('pane') === 'contacts' ? 'contacts' : 'mail'
const select = params.get('select')
const tab = params.get('tab')
const sheet = params.get('sheet')

function Harness() {
  useEffect(() => {
    const st = useApp.getState()
    st.setRailView(view as never)
    st.setMailPane(pane)
    // Give the mail surface the full height for the shots; the bottom bar and
    // the update banner are shell chrome that other screens already document.
    st.setBottomCollapsed(true)
    void (async () => {
      await st.refreshMailAccounts()
      await st.refreshMailContacts()
      await st.refreshMail()
      if (select) await useApp.getState().selectMailMessage(Number(select))
      if (sheet === 'compose') useApp.getState().openCompose({ to: 'lerato@sableretail.example' })
      if (sheet === 'reply') useApp.getState().replyToSelected()
      if (sheet === 'account') useApp.getState().openMailAccountEditor(2)
      if (sheet === 'account-new') useApp.getState().openMailAccountEditor(0)
      // Tabs live in component state; click the label the same way a user does.
      if (tab) {
        setTimeout(() => {
          const btn = [...document.querySelectorAll('button')].find((b) =>
            b.textContent?.toLowerCase().startsWith(tab.toLowerCase()),
          )
          btn?.click()
        }, 250)
      }
      // Dismiss the update banner the way a user would.
      const dismiss = [...document.querySelectorAll('button')].find(
        (b) => b.title === 'Dismiss' || b.getAttribute('aria-label') === 'Dismiss',
      )
      dismiss?.click()
      document.documentElement.dataset.ready = '1'
    })()
  }, [])
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
)
