import { Icon, type IconName } from '../../lib/icons'
import './design-system.css'

import { statePresentation } from './states'

export function StateBadge({ state, label }: { state: string; label?: string }) {
  const presentation = statePresentation(state)
  return <span className="ds-state" data-tone={presentation.tone}>
    <Icon name={presentation.icon} size={13}/>
    {label ?? presentation.label ?? state.replaceAll('_', ' ')}
  </span>
}
export type FilterOption<T extends string = string> = { id: T; label: string; icon: IconName; count?: number | string; description?: string; accessibleLabel?: string }
/** Filters use pressed buttons; navigation tabs require tab/tabpanel keyboard behavior. */
export function FilterTabs<T extends string>({ label, options, value, onChange, appearance = 'filter' }: {
  label: string; options: FilterOption<T>[]; value: T; onChange: (value: T) => void; appearance?: 'filter' | 'compact'
}) {
  return <div className={`ds-filter-tabs${appearance === 'compact' ? ' ds-compact-tabs' : ''}`} role="group" aria-label={label}>
    {options.map(option => <button type="button" key={option.id} aria-label={option.accessibleLabel ?? option.label}
      aria-description={option.count == null ? undefined : `${option.count} items`} title={option.description ?? option.label} aria-pressed={value === option.id} onClick={() => onChange(option.id)}>
      <Icon name={option.icon} size={16}/><span>{option.label}</span>
      {option.count != null && <span className="ds-count">{option.count}</span>}
    </button>)}
  </div>
}

/** Compact status for dense rows. The accessible name retains the state meaning. */
export function StateIcon({ state, label, size = 14 }: { state: string; label?: string; size?: number }) {
  const presentation = statePresentation(state)
  const text = label ?? presentation.label ?? state.replaceAll('_', ' ')
  return <span className="ds-state-icon" data-tone={presentation.tone} role="img" aria-label={text} title={text}><Icon name={presentation.icon} size={size}/></span>
}

/** A tab strip for surfaces with an associated panel. Arrow keys activate tabs. */
export function TabStrip<T extends string>({label, options, value, onChange, panelId, appearance = 'underline'}: {
  label: string; options: FilterOption<T>[]; value: T; onChange: (value: T) => void; panelId: string; appearance?: 'underline' | 'editor'
}) {
  return <div className={`ds-filter-tabs ${appearance === 'editor' ? 'ds-editor-tabs' : 'ds-compact-tabs'}`} role="tablist" aria-label={label}>
    {options.map((option, index) => <button key={option.id} type="button" role="tab"
      id={panelId+'-tab-'+option.id} aria-selected={value===option.id} aria-controls={panelId}
      tabIndex={value===option.id?0:-1} onClick={()=>onChange(option.id)}
      onKeyDown={event=>{
        const next=event.key==='Home'?0:event.key==='End'?options.length-1:event.key==='ArrowRight'?(index+1)%options.length:event.key==='ArrowLeft'?(index-1+options.length)%options.length:null
        if(next==null)return
        event.preventDefault();onChange(options[next].id)
        const buttons=event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        buttons?.[next]?.focus()
      }}>
      <Icon name={option.icon} size={16}/><span>{option.label}</span>
      {option.count!=null&&<span className="ds-count">{option.count}</span>}
    </button>)}
  </div>
}
