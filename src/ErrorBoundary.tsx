// When the interface throws, say so.
//
// React unmounts the whole tree when a render throws and nothing catches it,
// which in a desktop shell means a window that is simply blank — no message,
// no console you can reach, nothing to tell a person whether the app is
// starting, hung, or broken. That is the worst failure this app can produce,
// and it produced it: a white window for twenty minutes while the cause was a
// single component.
//
// Same rule as everywhere else here: never let a failure look like a state.

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface State {
  error: Error | null
  where: string
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, where: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The component stack is what actually names the culprit; the message on
    // its own rarely does.
    this.setState({ where: info.componentStack ?? '' })
    console.error('devdeck: the interface threw', error, info.componentStack)
  }

  render() {
    const { error, where } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex h-full w-full flex-col gap-3 overflow-auto bg-app p-6 text-ink">
        <div>
          <h1 className="text-[15px] font-semibold">DevDeck stopped drawing</h1>
          <p className="mt-1 text-[12px] leading-[1.6] text-muted">
            Something in the interface threw while rendering. Everything on disk is
            untouched — the vault, your spaces and the database are not involved in this.
            Reloading usually gets you back in; the text below is what to report.
          </p>
        </div>

        <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap rounded border border-red-500/30 bg-red-500/[0.06] px-3 py-2 font-mono text-[11px] leading-[1.5] text-err">
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ''}
        </pre>

        {where && (
          <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap rounded border border-line bg-panel px-3 py-2 font-mono text-[10.5px] leading-[1.5] text-dim">
            {where.trim()}
          </pre>
        )}

        <div className="flex gap-2">
          <button className="btn-primary text-[12px]" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button
            className="btn-ghost text-[12px]"
            onClick={() => {
              void navigator.clipboard?.writeText(
                `${error.message}\n\n${error.stack ?? ''}\n\n${where}`,
              )
            }}
          >
            Copy the details
          </button>
        </div>
      </div>
    )
  }
}
