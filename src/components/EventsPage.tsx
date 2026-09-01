// The event bus as a place you go, not only a panel you glance at.
//
// The bottom-bar tab is for watching while you do something else. This is for
// when the events *are* the thing you came for: full height, same stream, same
// filter. One component, two surfaces — the panel and the page cannot drift
// apart because there is nothing to keep in step.

import { EventStream } from './EventStream'

export function EventsPage() {
  return (
    <div className="flex h-full flex-col bg-page">
      <div className="flex shrink-0 items-start gap-2.5 border-b border-line px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Events</h2>
          <p className="text-[11.5px] text-muted">
            Everything the AI Workspace has processed, in the order it happened.
          </p>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <EventStream />
      </div>
    </div>
  )
}
