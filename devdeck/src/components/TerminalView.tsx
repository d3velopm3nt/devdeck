// One xterm.js terminal attached to a backend PTY session. Sessions
// outlive this component (persistent); on mount we replay scrollback.

import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import * as ipc from '../lib/ipc'
import { registerTerm, unregisterTerm } from '../lib/termBus'

export function TerminalView({ ptyId }: { ptyId: number }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const term = new Terminal({
      fontFamily: 'Cascadia Mono, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 8000,
      theme: {
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
    })
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
      term.dispose()
    }
  }, [ptyId])

  return <div ref={hostRef} className="h-full w-full bg-[#0d1017] pl-2 pt-1" />
}
