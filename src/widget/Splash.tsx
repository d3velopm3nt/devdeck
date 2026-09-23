// The splash window: the first thing on screen, before the main window has
// anything to show. Rust owns its lifetime — it's closed from `reveal_main`
// the moment the real window is ready — so this component has nothing to
// wire up, only something to look at while that happens.

import { Icon } from '../lib/icons'

export function Splash() {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 rounded-xl border border-line2 bg-menu">
      <img src="/favicon.svg" alt="" width={40} height={38} draggable={false} />
      <span className="text-[13px] font-semibold tracking-wide text-ink">DevDeck</span>
      <Icon name="spinner" size={16} spin className="text-muted" />
    </div>
  )
}
