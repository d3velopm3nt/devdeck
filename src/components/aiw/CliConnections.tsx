import { useCallback, useEffect, useRef, useState } from 'react'
import { cliSetupPlan, cliSetupStatus, type CliAction, type CliStatus, type CliTool } from '../../lib/cliSetup'
import { injectWhenReady, openTerminal } from '../../lib/runner'
import { openTerminalPanel } from '../../lib/dock'
import { Mark } from './providerDefs'

const TOOLS: { id: CliTool; name: string; cli: string; mark: string; installer: string }[] = [
  { id: 'claude-code', name: 'Claude', cli: 'Claude Code', mark: 'anthropic', installer: 'claude.ai/install.ps1' },
  { id: 'codex', name: 'ChatGPT', cli: 'Codex CLI', mark: 'openai', installer: 'chatgpt.com/codex/install.ps1' },
]

export function CliConnections({ onChanged }: { onChanged?: () => void }) {
  return (
    <section className="mb-5 rounded-lg border border-line bg-raise p-4" aria-label="Subscription connections">
      <h3 className="text-[14px] font-semibold text-ink">Subscriptions</h3>
      <p className="mt-1 text-[11.5px] text-muted">Install the official CLI, then sign in with your existing account.</p>
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
        {TOOLS.map(tool => <CliConnection key={tool.id} tool={tool} onChanged={onChanged} />)}
      </div>
      <p className="mt-3 text-[10.5px] leading-5 text-muted">
        After sign-in, choose Claude subscription or ChatGPT subscription as the default assistant provider.
        Assistants and managers use DevDeck tools and permissions. Usage shares your plan limits.
      </p>
    </section>
  )
}

function CliConnection({ tool, onChanged }: { tool: typeof TOOLS[number]; onChanged?: () => void }) {
  const [status, setStatus] = useState<CliStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [pending, setPending] = useState<CliAction | null>(null)
  const [terminal, setTerminal] = useState<number | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const lastAuth = useRef<string | null>(null)
  const changed = useRef(onChanged)
  changed.current = onChanged

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const next = await cliSetupStatus(tool.id)
      if (!mounted.current) return null
      setStatus(next)
      setError('')
      const authChanged = lastAuth.current !== next.auth
      const hadStatus = lastAuth.current !== null
      lastAuth.current = next.auth
      if (authChanged && (hadStatus || next.auth === 'subscription')) changed.current?.()
      return next
    } catch (e) {
      if (mounted.current) setError(String(e))
      return null
    } finally {
      if (mounted.current) setChecking(false)
    }
  }, [tool.id])

  useEffect(() => {
    mounted.current = true
    void check()
    return () => { mounted.current = false }
  }, [check])

  useEffect(() => {
    if (!pending) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const deadline = Date.now() + 10 * 60_000
    const poll = async () => {
      const next = await check()
      if (stopped || !mounted.current) return
      if (next && (pending === 'install' ? next.installed : next.auth === 'subscription')) {
        setPending(null)
        setMessage(pending === 'install' ? 'Installation verified. You can now sign in.' : 'Subscription sign-in verified.')
      } else if (Date.now() >= deadline) {
        setPending(null)
        setMessage('Setup has not been confirmed. Inspect the terminal, then check status or retry.')
      } else {
        timer = setTimeout(() => { void poll() }, 4000)
      }
    }
    timer = setTimeout(() => { void poll() }, 4000)
    return () => { stopped = true; clearTimeout(timer) }
  }, [pending, check])

  const start = async (action: CliAction) => {
    setLaunching(true)
    setError('')
    setMessage('')
    try {
      const plan = await cliSetupPlan(tool.id, action)
      const id = await openTerminal(plan.shell, plan.cwd, plan.title)
      await injectWhenReady(id, plan.command)
      if (!mounted.current) return
      setTerminal(id)
      setPending(action)
      setMessage(action === 'install'
        ? 'Official install command sent to the DevDeck terminal. Follow its output; DevDeck will check installation.'
        : 'Complete the official sign-in flow in your browser or the DevDeck terminal. Opening it does not confirm sign-in.')
    } catch (e) {
      if (mounted.current) setError(String(e))
    } finally {
      if (mounted.current) setLaunching(false)
    }
  }

  const label = !status ? 'Checking installation…' : !status.installed ? 'Not installed'
    : status.auth === 'subscription' ? 'Subscription signed in' : status.auth === 'api' ? 'API billing active'
    : status.auth === 'unknown' ? 'Account check needed' : 'Sign-in required'
  const disabled = launching || pending !== null || !status?.setup_supported
  return (
    <article className="rounded-md border border-line bg-app p-3" aria-label={`${tool.name} subscription`}>
      <div className="flex items-center gap-2.5">
        <Mark id={tool.mark} size={24} />
        <div className="min-w-0 flex-1">
          <h4 className="text-[13px] font-semibold text-ink">{tool.name}</h4>
          <div className="text-[10.5px] text-muted">{tool.cli}{status?.version ? ` · ${status.version}` : ''}</div>
        </div>
        <span className={`text-[10.5px] ${status?.auth === 'subscription' ? 'text-ok' : 'text-muted'}`}>{label}</span>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-dim">{status?.detail || 'Checking the installed CLI and active account.'}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!status?.installed && <button className="btn-primary text-[11px]" disabled={disabled} onClick={() => void start('install')}>Install {tool.cli}</button>}
        {status?.installed && <button className="btn-primary text-[11px]" disabled={disabled} onClick={() => void start('sign-in')}>Sign in with {tool.name}</button>}
        <button className="btn-ghost text-[11px]" disabled={checking || launching} onClick={() => void check()}>Check status</button>
        {terminal !== null && <button className="btn-ghost text-[11px]" onClick={() => openTerminalPanel(terminal, `${tool.cli} setup`)}>View setup terminal</button>}
        {pending && <button className="btn-ghost text-[11px]" onClick={() => { setPending(null); setMessage('Status monitoring stopped. The terminal remains open; use Ctrl+C there to cancel setup.') }}>Stop monitoring</button>}
      </div>
      {!status?.installed && <p className="mt-2 text-[10.5px] text-muted">Install from {tool.installer}. Provider terms apply.</p>}
      {status && !status.setup_supported && <p className="mt-2 text-[11px] text-muted">In-app setup currently supports Windows.</p>}
      {message && <p role="status" className="mt-2 text-[11px] leading-5 text-dim">{message}</p>}
      {error && <p role="alert" className="mt-2 text-[11px] text-err">{error}</p>}
    </article>
  )
}
