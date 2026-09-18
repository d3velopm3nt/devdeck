// Step one: the business, and what its website says.
//
// A new business starts empty. The site is read once the space exists, and
// what comes back is only ever a suggestion with its source. A site drawn by
// script returns little to a plain read, and the screen says so and offers to
// read it the way a browser draws it.

import { useEffect, useRef, useState } from 'react'
import * as ipc from '../../lib/ipc'
import { Icon } from '../../lib/icons'
import { Err, Header } from '../setup/LearnStep'
import { CAPTURE_BUSINESS_AUTO } from '../../lib/devCapture'
import { BizFrame, ItemRow, hostOf, yours, type StepProps } from './shared'

const FIELDS: { field: string; label: string }[] = [
  { field: 'what', label: 'What it does' },
  { field: 'serves', label: 'Who it serves' },
  { field: 'industry', label: 'Industry' },
  { field: 'where', label: 'Where' },
]

export function BusinessStep({ view, setView, nav, onClose, next }: StepProps) {
  const [name, setName] = useState('')
  const [website, setWebsite] = useState(view?.meta.website ?? '')
  const [dirs, setDirs] = useState<ipc.Director[]>(view?.meta.directors ?? [])
  const [busy, setBusy] = useState<'' | 'create' | 'plain' | 'browser'>('')
  const [err, setErr] = useState('')
  const [where, setWhere] = useState('')

  useEffect(() => {
    setWebsite(view?.meta.website ?? '')
    setDirs(view?.meta.directors ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.node_id])

  // Screenshot harness: read the site without a mouse, on a throwaway profile.
  const autoRan = useRef(false)
  useEffect(() => {
    if (autoRan.current || !view) return
    if (CAPTURE_BUSINESS_AUTO !== 'read' && CAPTURE_BUSINESS_AUTO !== 'browser') return
    autoRan.current = true
    window.setTimeout(() => void read(CAPTURE_BUSINESS_AUTO === 'browser', view), 4000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.node_id])

  const save = async (meta: ipc.BusinessMeta) => {
    if (!view) return null
    try {
      const v = await ipc.businessSave(view.node_id, meta)
      setView(v)
      return v
    } catch (e) {
      setErr(String(e))
      return null
    }
  }

  const read = async (browser: boolean, v: ipc.BusinessView | null = view) => {
    if (!v) return
    setBusy(browser ? 'browser' : 'plain')
    setErr('')
    try {
      setView(await ipc.businessReadSite(v.node_id, browser))
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy('')
    }
  }

  const create = async () => {
    setBusy('create')
    setErr('')
    try {
      const v = await ipc.businessCreate(name, website)
      setView(v)
      setBusy('')
      if (website.trim()) await read(false, v)
    } catch (e) {
      setErr(String(e))
      setBusy('')
    }
  }

  // ---- before the business exists -------------------------------------------
  if (!view) {
    return (
      <BizFrame step="business" view={view} nav={nav} onClose={onClose}>
        <Header
          icon="workspace"
          title="Add a business"
          text="A new business starts empty. Give it a name and its website, and I will read the site and suggest what the business is. Nothing is kept until you agree to it."
        />
        <div className="flex flex-col gap-3 rounded-[10px] border border-line bg-panel p-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] text-muted">Name</span>
            <input
              autoFocus
              className="input text-[12.5px]"
              placeholder="Innotrack"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] text-muted">Website</span>
            <input
              className="input font-mono text-[12px]"
              placeholder="innotrack.co.za"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()}
            />
          </label>
        </div>
        {err && <Err>{err}</Err>}
        <div className="flex items-center gap-3">
          <button className="btn-primary text-[12px]" disabled={!name.trim() || !!busy} onClick={() => void create()}>
            {busy ? 'Making the space…' : website.trim() ? 'Read the website' : 'Next'}
          </button>
          <button className="btn-ghost text-[12px]" onClick={onClose}>
            Not now
          </button>
        </div>
        <Foot>
          Nothing from your other businesses, Home or Your life is copied into a new business. It
          gets its own space, its own mail and its own team.
        </Foot>
      </BizFrame>
    )
  }

  // ---- the business, and what the site says ----------------------------------
  const meta = view.meta
  const host = hostOf(meta.website)
  const setItem = (id: string, next: ipc.Suggestion | null) =>
    void save({
      ...meta,
      directors: dirs,
      items: meta.items.flatMap((i) => (i.id === id ? (next ? [next] : []) : [i])),
    })
  const shown = (field: string) => meta.items.filter((i) => i.field === field && i.state !== 'declined')

  return (
    <BizFrame step="business" view={view} nav={nav} onClose={onClose} wide>
      <Header
        icon="workspace"
        title={meta.name}
        text="What the website says, as suggestions. Agree to what is right, change what is nearly right, and say no to the rest. Only what you agree to is kept."
      />

      <div className="grid min-h-0 grid-cols-[300px_minmax(0,1fr)] gap-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2.5 rounded-[10px] border border-line bg-panel p-4">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">The business</span>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-muted">Website</span>
              <input
                className="input font-mono text-[12px]"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                onBlur={() => website.trim() !== meta.website && void save({ ...meta, website, directors: dirs })}
              />
            </label>
            <div className="flex items-center gap-2 text-[11px]">
              {meta.site_read_at ? (
                <span className="flex items-center gap-1.5 text-ok">
                  <Icon name="check" size={12} />
                  Read{meta.site_how === 'browser' ? ' in a browser window' : ''}
                </span>
              ) : (
                <span className="text-muted">Not read yet</span>
              )}
              <span className="flex-1" />
              <button
                className="btn-ghost text-[11px]"
                disabled={!!busy || !website.trim()}
                onClick={() => void read(false)}
              >
                {meta.site_read_at ? 'Read again' : 'Read it'}
              </button>
            </div>
          </div>

          <div className="rounded-[10px] border border-line bg-panel">
            <div className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
              Who runs it
            </div>
            {dirs.map((d, i) =>
              d.you ? (
                <div key={`you-${i}`} className="flex items-center gap-2.5 border-t border-line px-4 py-2.5">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/15 text-[9.5px] font-semibold text-indigo-400">
                    YO
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] text-ink">You</div>
                    <div className="text-[11px] text-muted">director</div>
                  </div>
                </div>
              ) : (
                <div key={`d-${i}`} className="flex flex-col gap-1.5 border-t border-line px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      className="input min-w-0 flex-1 text-[12px]"
                      placeholder="Your partner's name"
                      value={d.name}
                      onChange={(e) => setDirs((cur) => cur.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                      onBlur={() => void save({ ...meta, directors: dirs })}
                    />
                    <button
                      className="btn-ghost text-[11px] text-muted"
                      title="Remove"
                      onClick={() => {
                        const next = dirs.filter((_, j) => j !== i)
                        setDirs(next)
                        void save({ ...meta, directors: next })
                      }}
                    >
                      <Icon name="close" size={11} />
                    </button>
                  </div>
                  <input
                    className="input font-mono text-[11.5px]"
                    placeholder="their address"
                    value={d.email}
                    onChange={(e) => setDirs((cur) => cur.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))}
                    onBlur={() => void save({ ...meta, directors: dirs })}
                  />
                  <span className="text-[10.5px] text-faint">
                    a director too. Kept with the business, not in Your life
                  </span>
                </div>
              ),
            )}
            <button
              className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-left text-[12px] text-dim hover:bg-hover"
              onClick={() => setDirs((cur) => [...cur, { name: '', email: '', you: false }])}
            >
              <Icon name="add" size={13} className="text-muted" />
              Add a partner
            </button>
          </div>
        </div>

        <div className="min-h-0 overflow-auto rounded-[10px] border border-line bg-panel">
          <div className="flex items-center gap-2 px-4 py-2.5">
            <Icon name="globe" size={14} className="text-muted" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              What the website says
            </span>
            <span className="flex-1" />
            <span className="font-mono text-[10.5px] text-faint">{host}</span>
          </div>

          {busy === 'plain' || busy === 'browser' ? (
            <div className="flex items-center gap-2.5 border-t border-line bg-raise px-4 py-3 text-[12px] text-dim">
              <Icon name="update" size={13} spin className="text-indigo-400" />
              {busy === 'browser'
                ? `Opening ${host} in a window you cannot see, and reading the pages as they draw…`
                : `Reading ${host}…`}
            </div>
          ) : view.site.title || view.site.excerpt ? (
            <div className="flex items-start gap-3 border-t border-line bg-raise px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] leading-snug text-ink">
                  {'“'}
                  {view.site.title || view.site.excerpt.slice(0, 160)}
                  {'”'}
                </div>
                <div className="mt-1 text-[11px] text-muted">
                  {view.site.thin
                    ? meta.site_how === 'browser'
                      ? 'even drawn in a browser window, the site has almost no words on it'
                      : "the site's title. A plain read returns almost nothing else, because the rest of the site is drawn by script"
                    : `${view.site.pages.length} ${view.site.pages.length === 1 ? 'page' : 'pages'} read${
                        meta.site_how === 'browser' ? ' in a browser window' : ''
                      }`}
                </div>
              </div>
              {view.site.thin && meta.site_how !== 'browser' && (
                <button className="btn-ghost shrink-0 text-[11.5px]" onClick={() => void read(true)}>
                  Read it in a browser window
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3 border-t border-line bg-raise px-4 py-3 text-[12px] text-muted">
              {meta.website ? 'The site has not been read yet.' : 'Add the website to read it.'}
              <span className="flex-1" />
              {meta.website && (
                <button className="btn-primary text-[11.5px]" onClick={() => void read(false)}>
                  Read the website
                </button>
              )}
            </div>
          )}

          {FIELDS.map(({ field, label }) => {
            const rows = shown(field)
            if (field === 'where' && rows.length === 0) {
              return (
                <div key={field} className="flex items-start gap-3 border-t border-line px-3.5 py-2.5">
                  <span className="mt-[6px] w-[96px] shrink-0 text-[11px] text-muted">{label}</span>
                  <div className="min-w-0 flex-1">
                    <input
                      className="input w-full text-[12px]"
                      placeholder="City, country"
                      value={where}
                      onChange={(e) => setWhere(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && where.trim()) {
                          void save({ ...meta, directors: dirs, items: [...meta.items, yours('where', where.trim())] })
                          setWhere('')
                        }
                      }}
                    />
                    <div className="mt-0.5 text-[11px] text-muted">
                      {meta.site_read_at ? 'the site does not say' : 'or wait for the site to be read'}
                    </div>
                  </div>
                </div>
              )
            }
            return rows.map((item, i) => (
              <ItemRow key={item.id} item={item} label={i === 0 ? label : ''} onChange={(next) => setItem(item.id, next)} />
            ))
          })}
        </div>
      </div>

      {err && <Err>{err}</Err>}
      <div className="flex items-center gap-3">
        <button
          className="btn-primary text-[12px]"
          disabled={!!busy}
          onClick={async () => {
            const v = await save({ ...meta, website, directors: dirs.filter((d) => d.you || d.name.trim()) })
            if (v) next('sells')
          }}
        >
          Next: what it sells
        </button>
        <button className="btn-ghost text-[12px]" onClick={onClose}>
          Not now
        </button>
      </div>
      <Foot>
        Nothing from your other businesses, Home or Your life is copied into a new business. It gets
        its own space, its own mail and its own team.
      </Foot>
    </BizFrame>
  )
}

export function Foot({ children, icon = 'secret' }: { children: React.ReactNode; icon?: string }) {
  return (
    <div className="flex gap-2.5 border-t border-line pt-3">
      <Icon name={icon} size={15} className="mt-0.5 shrink-0 text-muted" />
      <p className="m-0 text-[11.5px] leading-relaxed text-muted">{children}</p>
    </div>
  )
}
