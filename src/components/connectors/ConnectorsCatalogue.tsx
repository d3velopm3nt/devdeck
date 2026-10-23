import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { inventory, type Connection, type Inventory } from '../../lib/connectors'
import { Icon } from '../../lib/icons'
import { availableEntries, categories, plannedEntries, type CatalogueEntry } from './catalogue'
import { ConnectorDetails } from './ConnectorDetails'
import { IntegrationMark } from './IntegrationMark'
import './connectors.css'

type Tab = 'All integrations' | 'Connected' | 'Explore'
const TABS: Tab[] = ['All integrations', 'Connected', 'Explore']
const stateLabels: Record<Connection['state'], string> = {
  configured: 'Configured', authenticated: 'Authenticated', verified: 'Verified',
  degraded: 'Needs attention', reconnect: 'Reconnect needed', 'missing-dependency': 'Missing dependency',
  paused: 'Paused', disconnected: 'Disconnected',
}

function ConnectionDialog({ entry, onClose, onUpdated }: {
  entry: CatalogueEntry; onClose: () => void; onUpdated: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className="connector-dialog" aria-label={`${entry.name} details`}
    onCancel={event => { event.preventDefault(); onClose() }}>
    <div className="connector-dialog-header"><span>{entry.planned ? 'Integration preview' : 'Connection details'}</span>
      <button type="button" aria-label="Close connector details" onClick={onClose}><Icon name="close" size={18} /></button>
    </div>
    {entry.planned ? <div className="connector-planned-detail">
      <IntegrationMark name={entry.mark} /><h2>{entry.name}</h2>
      <span className="connector-status connector-status-planned"><Icon name="clock" size={12} />Planned</span>
      <p>{entry.description}</p>
      <p>{entry.detail ?? `${entry.name} is not available in this build. This is a catalogue preview; no account connection or execution is enabled.`}</p>
      <p>Existing accounts and permissions are unchanged. This entry cannot connect an account or access your data.</p>
    </div> : <ConnectorDetails serviceId={entry.id} onUpdated={onUpdated} />}
  </dialog>
}

export function ConnectorsPage() {
  const [data, setData] = useState<Inventory>({ connections: [], feedConnections: [], errors: [], unavailable: [] })
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState(''), [category, setCategory] = useState('All')
  const [tab, setTab] = useState<Tab>('All integrations')
  const [selected, setSelected] = useState<CatalogueEntry | null>(null)
  const refresh = useCallback(async () => {
    setLoading(true)
    try { setData(await inventory()) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const matches = (entry: CatalogueEntry, account = '') =>
    (category === 'All' || entry.category === category) &&
    `${entry.name} ${entry.description} ${account}`.toLowerCase().includes(query.toLowerCase())
  const order = ['github', 'mail', 'ai', 'database', 'mcp', 'feed']
  const saved = data.connections.filter(connection => {
    const entry = availableEntries.find(item => item.id === connection.service)
    return entry && matches(entry, connection.name)
  }).sort((a, b) => order.indexOf(a.service) - order.indexOf(b.service))
  const available = availableEntries.filter(entry => !data.connections.some(c => c.service === entry.id) && matches(entry))
  const planned = plannedEntries.filter(entry => matches(entry))
  const explore = tab === 'All integrations' ? planned : [...available, ...planned]
  const noMatches = (tab === 'Connected' ? saved.length : tab === 'Explore' ? explore.length : saved.length + available.length + planned.length) === 0
  const openCustom = () => setSelected(availableEntries.find(entry => entry.id === 'mcp')!)
  const changeTabWithKey = (event: KeyboardEvent<HTMLButtonElement>, item: Tab) => {
    const current = TABS.indexOf(item)
    const next = event.key === 'ArrowRight' ? (current + 1) % TABS.length
      : event.key === 'ArrowLeft' ? (current + TABS.length - 1) % TABS.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null
    if (next === null) return
    event.preventDefault()
    setTab(TABS[next])
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
  }

  const renderCard = (entry: CatalogueEntry, connection?: Connection) => {
    const title = connection && entry.id !== 'github' ? connection.name : entry.name
    const mark = connection?.mark ?? (connection?.service === 'ai'
      ? /anthropic|claude/i.test(connection.name) ? 'anthropic' : /openai|codex/i.test(connection.name) ? 'openai' : entry.mark
      : entry.mark)
    const unavailable = data.unavailable.includes(entry.id)
    return <article key={connection?.id ?? entry.id} className="connector-card" data-service={entry.id} data-planned={entry.planned || undefined} aria-label={title}>
      <IntegrationMark name={mark} />
      <div className="connector-card-content">
        <div className="connector-card-top"><h3 title={title}>{title}</h3>
          <button className="connector-overflow" aria-label={`Details for ${title}`} onClick={() => setSelected(entry)}><Icon name="more" size={16} /></button>
        </div>
        <p className="connector-card-description" title={entry.description}>{entry.description}</p>
        <div className="connector-card-bottom">
          {connection ? <>
            <span className="connector-status" data-state={connection.state}><span className="connector-status-dot" />{stateLabels[connection.state]}</span>
            <button className="connector-button" aria-label={`Manage ${title}`} onClick={() => setSelected(entry)}>Manage</button>
          </> : <>
            <span className="connector-category" data-category={entry.category}>{entry.category}</span>
            {entry.planned ? <span className="connector-status connector-status-planned"><Icon name="clock" size={11} />Planned</span> :
              <span className="connector-status">{unavailable ? 'Unavailable' : 'Available'}</span>}
            <button className="connector-details-link" aria-label={`${entry.planned ? 'View details for' : 'Configure'} ${entry.name}`} onClick={() => setSelected(entry)}>
              {entry.planned ? 'View details' : 'Configure'}<Icon name="arrow-right" size={12} />
            </button>
          </>}
        </div>
      </div>
    </article>
  }

  return <div className="connectors-page"><div className="connectors-inner">
    <header className="connectors-header">
      <div><h1>Connectors</h1><p>Bring your tools, accounts and knowledge into DevDeck.</p></div>
      <div className="connectors-header-actions">
        <span className="connector-workspace-badge">Local workspace <Icon name="info" size={13} /></span>
        <button className="connector-button connector-button-accent" onClick={openCustom}><Icon name="add" size={15} />Custom connector</button>
      </div>
    </header>
    <label className="connector-search"><Icon name="search" size={18} />
      <input aria-label="Search connectors" placeholder="Search integrations..." value={query} onChange={event => setQuery(event.target.value)} />
    </label>
    <div className="connector-tabs" role="tablist" aria-label="Integration views">
      {TABS.map(item => <button key={item} role="tab" aria-selected={tab === item} tabIndex={tab === item ? 0 : -1}
        aria-controls="connector-catalogue-panel" onKeyDown={event => changeTabWithKey(event, item)} onClick={() => setTab(item)}>{item}</button>)}
    </div>
    <div className="connector-chips" role="group" aria-label="Connector category">
      {categories.map(item => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}
    </div>
    <div role="tabpanel" id="connector-catalogue-panel" aria-label={tab}>
    {data.errors.map(error => <p key={error} role="alert" className="connector-notice">{error}</p>)}
    {loading && <p role="status" className="connector-notice">Reading saved connections...</p>}
    {tab === 'Connected' && <p className="text-xs text-dim">Saved connections, including configurations that have not been verified.</p>}
    {tab !== 'Explore' && (saved.length > 0 || (tab === 'All integrations' && available.length > 0) || tab === 'Connected') && <section className="connector-section" aria-label="Your connections">
      <div className="connector-section-heading"><h2>Your connections</h2><span className="connector-count">{saved.length} saved</span>
        <button className="connector-refresh" aria-label="Refresh inventory" title="Refresh saved connections" disabled={loading} onClick={() => void refresh()}><Icon name="update" size={13} spin={loading} /></button>
      </div>
      <div className="connector-grid">{saved.map(connection => renderCard(availableEntries.find(entry => entry.id === connection.service)!, connection))}{tab === 'All integrations' && available.map(entry => renderCard(entry))}</div>
    </section>}
    {tab !== 'Connected' && explore.length > 0 && <section className="connector-section" aria-label="Explore integrations">
      <div className="connector-section-heading"><h2>Explore integrations</h2><span className="connector-count">{tab === 'All integrations' ? 'Proposed catalogue' : planned.length ? 'Available & planned' : 'Available now'}</span>
        {saved.length === 0 && <button className="connector-refresh" aria-label="Refresh inventory" disabled={loading} onClick={() => void refresh()}><Icon name="update" size={13} spin={loading} /></button>}
      </div>
      <div className="connector-grid">{explore.map(entry => renderCard(entry))}</div>
    </section>}
    {!loading && noMatches && <p className="connector-empty">{query || category !== 'All' ? 'No matching connectors.' : 'No saved connections in this view.'}</p>}
    </div>
    <footer className="connector-custom">
      <div className="connector-custom-icon"><Icon name="puzzle" size={24} /></div>
      <div><h2>Need something else?</h2><p>Add an MCP server or configure an existing AI provider.</p></div>
      <button className="connector-button connector-button-accent" onClick={openCustom}><Icon name="add" size={13} />Add custom</button>
    </footer>
    {selected && <ConnectionDialog key={selected.id} entry={selected} onClose={() => setSelected(null)} onUpdated={refresh} />}
  </div></div>
}
