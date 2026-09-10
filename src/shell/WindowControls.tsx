// Minimise, maximise, close — ours now, because the window has no frame.
//
// Dropping the native title bar buys back ~32px of vertical space and removes
// a strip of chrome that said nothing except the app's own name, which the
// top bar already says. The cost is that these three become our problem, and
// a window you cannot close is a much worse bug than a slightly taller one —
// so they are plain, always visible, and never behind a menu.
//
// Windows convention: this order, close on the right, and only close turns red.

import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const win = getCurrentWindow()
    let stop: (() => void) | undefined
    void win.isMaximized().then(setMaximized).catch(() => {})
    // The window can be maximised by a drag to the top edge or a keyboard
    // shortcut, neither of which comes through our buttons — so the glyph
    // follows the window rather than our last click.
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized).catch(() => {})
      })
      .then((un) => {
        stop = un
      })
      .catch(() => {})
    return () => stop?.()
  }, [])

  const win = () => getCurrentWindow()

  return (
    <div className="flex shrink-0 items-stretch">
      <button
        className="flex w-[44px] items-center justify-center text-dim hover:bg-hover hover:text-ink"
        title="Minimise"
        onClick={() => void win().minimize()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <rect x="0" y="4.5" width="10" height="1" fill="currentColor" />
        </svg>
      </button>

      <button
        className="flex w-[44px] items-center justify-center text-dim hover:bg-hover hover:text-ink"
        title={maximized ? 'Restore' : 'Maximise'}
        onClick={() => void win().toggleMaximize()}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none" stroke="currentColor">
            <rect x="0.5" y="2.5" width="7" height="7" />
            <path d="M2.5 2.5V0.5h7v7h-2" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none" stroke="currentColor">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </button>

      {/* The only one that goes red, because it is the only one you cannot
          undo by clicking again. */}
      <button
        className="flex w-[46px] items-center justify-center text-dim hover:bg-red-600 hover:text-white"
        title="Close"
        onClick={() => void win().close()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none" stroke="currentColor">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  )
}
