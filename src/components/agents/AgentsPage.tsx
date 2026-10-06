import { useCallback, useEffect, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { subtreeIds } from '../../lib/tree'
import { openBot } from '../../lib/dock'
import { WorkersPage } from '../workers/WorkersPage'
import { Settings } from '../aiw/Settings'
import { aiw } from '../../lib/aiw'
import { Icon } from '../../lib/icons'

const DOMAINS = ['life', 'personal', 'business'] as const
const STARTERS = {
  life: {
    role: 'Life coordinator',
    responsibilities: [
      'Coordinate priorities across life and work',
      'Surface scheduling conflicts and decisions',
      'Prepare a short daily briefing',
    ],
    boundaries: [
      'Share only availability and agreed summaries with business managers',
      'Ask before changing commitments',
    ],
  },
  personal: {
    role: 'Personal manager',
    responsibilities: [
      'Maintain personal goals and learning routines',
      'Track home and family tasks',
      'Suggest a realistic next action',
    ],
    boundaries: [
      'Keep private details within this space',
      'Ask before bookings, purchases or messages to other people',
    ],
  },
  business: {
    role: 'Business manager',
    responsibilities: [
      'Turn business goals into reviewed tasks',
      'Assign specialists and track blockers',
      'Report progress with evidence and next decisions',
    ],
    boundaries: [
      'Do not access personal records',
      'Ask before spending, sending externally, publishing or merging',
    ],
  },
}
const emptyProfile = (): ipc.ManagerProfile => ({
  revision: 0,
  domain: 'business',
  ...STARTERS.business,
  peers: [],
  workers: [],
})
const lines = (s: string) =>
  s
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

export function AgentsPage() {
  const [tab, setTab] = useState<'managers' | 'specialists' | 'engines'>(
    'managers'
  )
  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <header className="border-b border-line px-6 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-ink">Agents</h1>
            <p className="mt-1 text-sm text-muted">
              Managers own outcomes. Specialists do bounded work. You stay in
              control.
            </p>
          </div>
          <span className="rounded-full border border-line px-3 py-1 text-xs text-dim">
            Life · Personal · Business
          </span>
        </div>
        <nav className="mt-5 flex gap-6" aria-label="Agent views">
          {(['managers', 'specialists', 'engines'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`border-b-2 pb-3 text-sm ${tab === t ? 'border-indigo-500 font-semibold text-ink' : 'border-transparent text-muted'}`}
            >
              {t === 'engines'
                ? 'Engines & permissions'
                : t === 'managers'
                  ? 'Managers'
                  : 'Specialists'}
            </button>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1">
        {tab === 'managers' ? (
          <ManagerHub />
        ) : tab === 'specialists' ? (
          <WorkersPage />
        ) : (
          <Settings />
        )}
      </div>
    </div>
  )
}

export function ManagerHub() {
  const nodes = useApp((s) => s.nodes)
  const scope = useApp((s) => s.spaceScopeId)
  const refreshBots = useApp((s) => s.refreshBots)
  const [team, setTeam] = useState<ipc.TeamMember[]>([])
  const [workers, setWorkers] = useState<ipc.Worker[]>([])
  const [selected, setSelected] = useState('')
  const [filter, setFilter] = useState('all')
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNode, setNewNode] = useState(0)
  const [newDomain, setNewDomain] = useState<keyof typeof STARTERS>('business')
  const [busy, setBusy] = useState(false)
  const reload = useCallback(async () => {
    try {
      const [t, w] = await Promise.all([ipc.managerTeam(), ipc.workersList()])
      setTeam(t)
      setWorkers(w)
    } catch (e) {
      setError(String(e))
    }
  }, [])
  useEffect(() => {
    void reload()
    const stop = aiw.onEvent((e) => {
      if (e.type.startsWith('manager.')) void reload()
    })
    return () => {
      void stop.then((off) => off())
    }
  }, [reload])
  const scopeIds = scope == null ? null : new Set(subtreeIds(nodes, scope))
  const visibleTeam = team.filter(
    (t) =>
      !scopeIds ||
      scopeIds.has(t.bot.node_id) ||
      (t.bot.businesses ?? []).some((id) => scopeIds.has(id))
  )
  useEffect(() => {
    setSelected('')
    setNewNode(scope ?? 0)
  }, [scope])
  const pendingCount = visibleTeam.reduce((n, t) => n + t.pending, 0)
  const current = visibleTeam.find((t) => t.bot.handle === selected)
  const create = async () => {
    if (!newNode || !newName.trim()) {
      setError('Choose a space and name your manager.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const starter = STARTERS[newDomain]
      const bot = await ipc.botCreate({
        nodeId: newNode,
        templateId: '',
        name: newName.trim(),
        goal: starter.responsibilities[0],
        every: '',
        atMin: 480,
        days: '',
        withPlan: false,
      })
      await ipc.managerProfileSave(bot.handle, {
        ...emptyProfile(),
        domain: newDomain,
        ...starter,
      })
      await refreshBots()
      await reload()
      setCreating(false)
      setSelected(bot.handle)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-6">
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-err"
        >
          {error}
        </div>
      )}
      <div className="mb-5 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {DOMAINS.map((d) => (
          <button
            key={d}
            onClick={() => {
              setFilter(filter === d ? 'all' : d)
              setSelected('')
            }}
            className={`rounded-xl border p-4 text-left ${filter === d ? 'border-indigo-500 bg-indigo-500/10' : 'border-line bg-panel'}`}
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-viol">
              {d}
            </span>
            <div className="mt-1 text-lg font-semibold text-ink">
              {visibleTeam.filter((t) => t.profile.domain === d).length}{' '}
              {visibleTeam.filter((t) => t.profile.domain === d).length === 1
                ? 'manager'
                : 'managers'}
            </div>
            <p className="mt-1 text-xs text-muted">
              {d === 'life'
                ? 'Priorities, commitments and your daily briefing'
                : d === 'personal'
                  ? 'Home, family, learning and personal goals'
                  : 'Companies, products, delivery and decisions'}
            </p>
          </button>
        ))}
      </div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">
            {scope == null
              ? 'Your management team'
              : `${nodes.find((n) => n.id === scope)?.name ?? 'Space'} managers`}
          </h2>
          <p className="text-sm text-muted">
            {pendingCount} {pendingCount === 1 ? 'message' : 'messages'}{' '}
            awaiting a response
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost text-sm" onClick={() => void reload()}>
            Refresh
          </button>
          <button
            className="btn-primary text-sm"
            onClick={() => setCreating(!creating)}
          >
            <Icon name="add" size={14} />
            New manager
          </button>
        </div>
      </div>
      {creating && (
        <section
          className="mb-5 rounded-xl border border-line bg-panel p-4"
          aria-label="Create manager"
        >
          <h3 className="mb-3 font-semibold text-ink">
            Give a space an accountable manager
          </h3>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm text-dim">
              Name
              <input
                aria-label="Manager name"
                className="input mt-1 w-full"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </label>
            <label className="text-sm text-dim">
              Space
              <select
                aria-label="Manager space"
                className="input mt-1 w-full"
                value={newNode}
                onChange={(e) => setNewNode(Number(e.target.value))}
              >
                <option value={0}>Choose a space</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-dim">
              Role starter
              <select
                aria-label="Role starter"
                className="input mt-1 w-full"
                value={newDomain}
                onChange={(e) =>
                  setNewDomain(e.target.value as keyof typeof STARTERS)
                }
              >
                {DOMAINS.map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="my-3 text-xs text-muted">
            Starts without a schedule, engine, peer connections or spending
            permissions. Configure those after reviewing its responsibilities.
          </p>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => void create()}
          >
            Create manager
          </button>
        </section>
      )}
      <div className="grid min-h-0 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-2">
          {visibleTeam
            .filter((t) => filter === 'all' || t.profile.domain === filter)
            .map((t) => (
              <button
                key={t.bot.handle}
                onClick={() => setSelected(t.bot.handle)}
                className={`w-full rounded-xl border p-4 text-left ${selected === t.bot.handle ? 'border-indigo-500 bg-indigo-500/10' : 'border-line bg-panel hover:bg-hover'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="text-sm text-ink">{t.bot.name}</strong>
                  {t.pending > 0 && (
                    <span className="rounded-full bg-amber-500/15 px-2 text-xs text-warn">
                      {t.pending}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-dim">
                  {t.profile.role || 'Role needs setup'}
                </p>
                <p className="mt-2 text-xs text-muted">
                  {t.bot.node_name || 'No home space'} ·{' '}
                  {t.bot.agent ? 'Engine assigned' : 'Watching only'}
                </p>
              </button>
            ))}
          {team.length === 0 && (
            <p className="rounded-xl border border-dashed border-line p-5 text-sm text-muted">
              Start with a Life coordinator or a manager for one business. Add
              specialists when there is work to delegate.
            </p>
          )}
        </div>
        {current ? (
          <ManagerWorkspace
            key={current.bot.handle}
            member={current}
            team={team}
            workers={workers}
            onChanged={reload}
          />
        ) : (
          <div className="rounded-xl border border-line bg-panel p-8">
            <Icon name="bot" size={28} className="text-viol" />
            <h3 className="mt-4 text-lg font-semibold text-ink">
              Clear ownership, shared decisions
            </h3>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
              Choose a manager to define its responsibilities, connect trusted
              peers and review messages. A connection shares explicit messages
              only; it does not grant access to another space’s files or private
              memory.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {['Set responsibilities', 'Connect peers', 'Review outcomes'].map(
                (s, i) => (
                  <div
                    key={s}
                    className="rounded-lg bg-soft p-3 text-sm text-dim"
                  >
                    <span className="mr-2 text-viol">{i + 1}</span>
                    {s}
                  </div>
                )
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ManagerWorkspace({
  member,
  team,
  workers,
  onChanged,
}: {
  member: ipc.TeamMember
  team: ipc.TeamMember[]
  workers: ipc.Worker[]
  onChanged: () => Promise<void>
}) {
  const bot = member.bot
  const [profile, setProfile] = useState<ipc.ManagerProfile>(
    member.profile.domain ? member.profile : emptyProfile()
  )
  const [messages, setMessages] = useState<ipc.ManagerMessage[]>([])
  const [tab, setTab] = useState<
    'responsibilities' | 'messages' | 'conversation'
  >('responsibilities')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [reply, setReply] = useState<string | null>(null)
  const [chat, setChat] = useState<import('../../lib/aiw').ChatMessage[]>([])
  const [request, setRequest] = useState('')
  const [task, setTask] = useState('')
  const [preferred, setPreferred] = useState(bot.worker ?? '')
  const load = useCallback(
    () =>
      Promise.all([
        ipc.managerMessages(bot.handle).then(setMessages),
        ipc.managerConversation(bot.handle).then(setChat),
      ]).catch((e) => setError(String(e))),
    [bot.handle]
  )
  useEffect(() => {
    void load()
    const stop = aiw.onEvent((e) => {
      if (e.type === 'manager.message.delivered') void load()
    })
    return () => {
      void stop.then((off) => off())
    }
  }, [load])
  const peers = team.filter(
    (t) =>
      member.profile.peers.includes(t.bot.handle) &&
      t.profile.peers.includes(bot.handle)
  )
  const toggle = (key: 'peers' | 'workers', handle: string) =>
    setProfile((p) => ({
      ...p,
      [key]: p[key].includes(handle)
        ? p[key].filter((x) => x !== handle)
        : [...p[key], handle],
    }))
  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const p = await ipc.managerProfileSave(bot.handle, {
        ...profile,
        responsibilities: lines(profile.responsibilities.join('\n')),
        boundaries: lines(profile.boundaries.join('\n')),
      })
      setProfile(p)
      await ipc.botSetWorker(bot.handle, preferred)
      await onChanged()
      setNotice('Responsibilities and team saved.')
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const send = async () => {
    setBusy(true)
    setError('')
    try {
      await ipc.managerMessageSend(bot.handle, {
        to,
        kind: reply ? 'reply' : 'request',
        subject,
        body,
        reply_to: reply,
      })
      setBody('')
      setSubject('')
      setReply(null)
      await load()
      await onChanged()
      setNotice('Delivered to the manager inbox. No agent was started.')
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const acknowledge = async (m: ipc.ManagerMessage) => {
    setError('')
    try {
      await ipc.managerMessageSend(bot.handle, {
        to: m.from,
        kind: 'acknowledgement',
        subject: m.subject,
        body: 'Acknowledged by the person reviewing this inbox.',
        reply_to: m.id,
      })
      await load()
      await onChanged()
    } catch (e) {
      setError(String(e))
    }
  }
  return (
    <section
      className="rounded-xl border border-line bg-panel"
      aria-label={`${bot.name} workspace`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5">
        <div>
          <h2 className="text-lg font-semibold text-ink">{bot.name}</h2>
          <p className="mt-1 text-sm text-muted">{bot.goal}</p>
        </div>
        <button
          className="btn-ghost text-xs"
          onClick={() => openBot(bot.node_id, bot.name, false, bot.handle)}
        >
          Plan, engine & schedule
        </button>
      </div>
      <div className="flex gap-5 border-b border-line px-5">
        {(['responsibilities', 'messages', 'conversation'] as const).map(
          (t) => (
            <button
              key={t}
              className={`py-3 text-sm ${tab === t ? 'font-semibold text-ink' : 'text-muted'}`}
              onClick={() => setTab(t)}
            >
              {t === 'messages'
                ? 'Communication'
                : t === 'conversation'
                  ? 'Conversation'
                  : 'Responsibilities & team'}
            </button>
          )
        )}
      </div>
      <div className="space-y-4 p-5">
        {error && (
          <p role="alert" className="text-sm text-err">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-ok">
            {notice}
          </p>
        )}
        {tab === 'responsibilities' ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
              <label className="text-sm text-dim">
                Area
                <select
                  aria-label="Manager area"
                  className="input mt-1 w-full"
                  value={profile.domain}
                  onChange={(e) =>
                    setProfile({ ...profile, domain: e.target.value })
                  }
                >
                  {DOMAINS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-dim">
                Role
                <input
                  aria-label="Manager role"
                  className="input mt-1 w-full"
                  value={profile.role}
                  onChange={(e) =>
                    setProfile({ ...profile, role: e.target.value })
                  }
                />
              </label>
            </div>
            <label className="block text-sm text-dim">
              Responsible for
              <textarea
                aria-label="Responsibilities"
                className="input mt-1 min-h-24 w-full"
                value={profile.responsibilities.join('\n')}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    responsibilities: e.target.value.split('\n'),
                  })
                }
              />
              <span className="text-xs text-muted">
                One responsibility per line.
              </span>
            </label>
            <label className="block text-sm text-dim">
              Boundaries & escalation
              <textarea
                aria-label="Boundaries"
                className="input mt-1 min-h-20 w-full"
                value={profile.boundaries.join('\n')}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    boundaries: e.target.value.split('\n'),
                  })
                }
              />
            </label>
            <div>
              <h3 className="text-sm font-semibold text-ink">
                Communication peers
              </h3>
              <p className="mt-1 text-xs text-muted">
                Both managers must connect to each other. Share only relevant
                summaries across Life, Personal and Business.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {team
                  .filter((t) => t.bot.handle !== bot.handle)
                  .map((t) => (
                    <label
                      key={t.bot.handle}
                      className="flex items-center gap-2 rounded-lg border border-line p-2 text-xs text-body"
                    >
                      <input
                        type="checkbox"
                        checked={profile.peers.includes(t.bot.handle)}
                        onChange={() => toggle('peers', t.bot.handle)}
                      />
                      {t.bot.name}
                      {profile.peers.includes(t.bot.handle) &&
                        !t.profile.peers.includes(bot.handle) && (
                          <span className="text-warn">
                            awaiting reciprocal connection
                          </span>
                        )}
                    </label>
                  ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">
                Specialist pool
              </h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {workers.map((w) => (
                  <label
                    key={w.handle}
                    className="flex items-center gap-2 rounded-lg border border-line p-2 text-xs text-body"
                  >
                    <input
                      type="checkbox"
                      checked={profile.workers.includes(w.handle)}
                      onChange={() => toggle('workers', w.handle)}
                    />
                    {w.name} · {w.what}
                  </label>
                ))}
              </div>
              {workers.length === 0 && (
                <p className="mt-1 text-xs text-muted">
                  Create a specialist on the Specialists tab first.
                </p>
              )}
            </div>
            <label className="block text-sm text-dim">
              Preferred specialist
              <select
                className="input mt-1 w-full"
                value={preferred}
                onChange={(e) => setPreferred(e.target.value)}
              >
                <option value="">None — watch and plan only</option>
                {workers.map((w) => (
                  <option key={w.handle} value={w.handle}>
                    {w.name}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted">
                Scheduled handoff prefers this specialist, then an available
                member of the pool. Space scope and unattended permission are
                checked before every run.
              </span>
            </label>
            <button
              className="btn-primary text-sm"
              disabled={busy}
              onClick={() => void save()}
            >
              Save responsibilities
            </button>
          </>
        ) : tab === 'conversation' ? (
          <>
            <p className="text-xs text-muted">
              One turn uses this manager’s configured engine and permissions.
              Review incoming requests or steer its priorities without needing a
              code repository.
            </p>
            <div className="max-h-80 space-y-3 overflow-auto">
              {chat.map((m, i) => (
                <article
                  key={`${m.at}:${i}`}
                  className="rounded-lg border border-line p-3"
                >
                  <span className="text-xs text-muted">
                    {m.by || m.from}
                    {m.tool ? ` · ${m.tool}` : ''}
                  </span>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-body">
                    {m.text}
                  </p>
                </article>
              ))}
            </div>
            <textarea
              aria-label="Manager request"
              className="input min-h-24 w-full"
              placeholder="What should this manager focus on?"
              value={request}
              onChange={(e) => setRequest(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <button
                className="btn-primary"
                disabled={busy || !request.trim()}
                onClick={() => {
                  setBusy(true)
                  setError('')
                  void ipc
                    .managerTurn(bot.handle, request)
                    .then(async () => {
                      setRequest('')
                      await load()
                      await onChanged()
                    })
                    .catch((e) => setError(String(e)))
                    .finally(() => setBusy(false))
                }}
              >
                {busy ? 'Working…' : 'Ask manager'}
              </button>
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() =>
                  setRequest(
                    'Review your pending manager messages. Respond to the highest-priority request within your responsibilities, or explain what needs my decision. Do not claim work is complete without evidence.'
                  )
                }
              >
                Review inbox
              </button>
            </div>
            <div className="border-t border-line pt-4">
              <h3 className="text-sm font-semibold text-ink">
                Add an agreed task
              </h3>
              <input
                aria-label="Manager task"
                className="input my-2 w-full"
                placeholder="A concrete next action with a clear result"
                value={task}
                onChange={(e) => setTask(e.target.value)}
              />
              <button
                className="btn-ghost"
                disabled={busy || !task.trim()}
                onClick={() => {
                  setBusy(true)
                  setError('')
                  void ipc
                    .botPlan(bot.node_id, [task.trim()], bot.handle)
                    .then(async () => {
                      setTask('')
                      setNotice('Task added to the manager’s plan.')
                      await onChanged()
                    })
                    .catch((e) => setError(String(e)))
                    .finally(() => setBusy(false))
                }}
              >
                Add to plan
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg bg-soft p-3 text-xs leading-relaxed text-dim">
              Requests and replies persist locally. Managers read pending
              messages on their next conversation or scheduled agent turn.
              Sending does not start an agent, grant tools or mark a task
              complete.
            </div>
            <div className="max-h-[420px] space-y-3 overflow-auto">
              {messages.length === 0 && (
                <p className="py-4 text-sm text-muted">
                  No messages yet. Connect a peer and send a focused request.
                </p>
              )}
              {messages.map((m) => {
                const answered = messages.some((r) => r.reply_to === m.id)
                return (
                  <article
                    key={m.id}
                    className="rounded-lg border border-line p-3"
                  >
                    <div className="flex justify-between gap-3 text-xs text-muted">
                      <span>
                        @{m.from} → @{m.to}
                      </span>
                      <span>
                        {m.kind} ·{' '}
                        {answered
                          ? 'answered'
                          : m.kind === 'acknowledgement'
                            ? 'closed'
                            : 'pending'}
                      </span>
                    </div>
                    <h4 className="mt-2 text-sm font-semibold text-ink">
                      {m.subject}
                    </h4>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-body">
                      {m.body}
                    </p>
                    {m.to === bot.handle &&
                      !answered &&
                      m.kind !== 'acknowledgement' && (
                        <div className="mt-3 flex gap-3">
                          <button
                            className="btn-ghost text-xs"
                            onClick={() => {
                              setTo(m.from)
                              setReply(m.id)
                              setSubject(`Re: ${m.subject}`)
                            }}
                          >
                            Reply
                          </button>
                          <button
                            className="btn-ghost text-xs"
                            onClick={() => void acknowledge(m)}
                          >
                            Acknowledge
                          </button>
                        </div>
                      )}
                  </article>
                )
              })}
            </div>
            <div className="border-t border-line pt-4">
              <h3 className="mb-2 text-sm font-semibold text-ink">
                {reply ? 'Reply to a manager' : 'Send a request'}
              </h3>
              <select
                aria-label="Message recipient"
                className="input w-full"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                disabled={!!reply}
              >
                <option value="">Choose a connected manager</option>
                {peers.map((t) => (
                  <option key={t.bot.handle} value={t.bot.handle}>
                    {t.bot.name}
                  </option>
                ))}
              </select>
              <input
                aria-label="Message subject"
                className="input mt-2 w-full"
                placeholder="Subject"
                maxLength={200}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
              <textarea
                aria-label="Message body"
                className="input mt-2 min-h-24 w-full"
                placeholder="What do you need, and by when?"
                maxLength={6000}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
              <div className="mt-2 flex gap-2">
                <button
                  className="btn-primary"
                  disabled={busy || !to || !subject.trim() || !body.trim()}
                  onClick={() => void send()}
                >
                  Send request
                </button>
                {reply && (
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      setReply(null)
                      setSubject('')
                    }}
                  >
                    Cancel reply
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
