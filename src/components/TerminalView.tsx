// One xterm.js terminal attached to a backend PTY session. Sessions
// outlive this component (persistent); on mount we replay scrollback.

import { useEffect, useRef } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import * as ipc from '../lib/ipc'
import { registerTerm, unregisterTerm } from '../lib/termBus'
import { useApp, type Theme } from '../store'

// ANSI palettes per app theme. The dark palette is DevDeck's original; the
// light one keeps the same hue map at readable-on-white weights.
const XTERM_THEMES: Record<Theme, ITheme> = {
  dark: {
    background: '#0d1017',
    foreground: '#d6dbe5',
    cursor: '#8b7cff',
    selectionBackground: '#31406b',
    black: '#1c202a',
    blue: '#5aa9ff',
    cyan: '#4cc9f0',
    green: '#4ade80',
    magenta: '#c678dd',
    red: '#f87171',
    yellow: '#e5c07b',
    white: '#d6dbe5',
  },
  light: {
    background: '#f6f7f9',
    foreground: '#24292f',
    cursor: '#6d5ce7',
    selectionBackground: '#c7d4f0',
    black: '#24292f',
    blue: '#0969da',
    cyan: '#0a7ea4',
    green: '#116932',
    magenta: '#8250df',
    red: '#cf222e',
    yellow: '#9a6700',
    white: '#6e7781',
  },
}

export function TerminalView({ ptyId }: { ptyId: number }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const theme = useApp((s) => s.theme)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: 'Cascadia Mono, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 8000,
      theme: XTERM_THEMES[useApp.getState().theme],
    })
    termRef.current = term
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)

    const doFit = () => {
      try {
        fit.fit()
        void ipc.ptyResize(ptyId, term.cols, term.rows)
      } catch {
        /* host not laid out yet */
      }
    }

    // Replay history, then live-attach.
    void ipc.ptyScrollback(ptyId).then((sb) => {
      if (sb) term.write(sb)
      registerTerm(ptyId, (data) => term.write(data))
    })

    const onData = term.onData((data) => {
      void ipc.ptyWrite(ptyId, data)
    })

    const ro = new ResizeObserver(() => doFit())
    ro.observe(host)
    // Initial fit after first layout tick.
    const t = setTimeout(doFit, 50)

    return () => {
      clearTimeout(t)
      ro.disconnect()
      onData.dispose()
      unregisterTerm(ptyId)
      termRef.current = null
      term.dispose()
    }
  }, [ptyId])

  // Re-skin live terminals when the app theme flips.
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = XTERM_THEMES[theme]
  }, [theme])

  return <div ref={hostRef} className="h-full w-full bg-page pl-2 pt-1" />
}
