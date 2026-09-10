// The one thing in the app that interrupts you.
//
// A reminder that fires and files itself silently into the Inbox has not
// reminded you of anything — telling you is its entire job, and until this
// existed the only way to learn that 09:00 had happened was to go and look.
//
// Only the clock gets to raise one. Everything else in the activity feed
// happened because you had just clicked something, and a toast for your own
// click is noise you learn to dismiss without reading — which is exactly how
// the one that mattered gets dismissed too.
//
// It does not disappear on a timer. A reminder you missed because you were
// typing is a reminder that did not work, and the whole point of this is to
// stop losing them.

import { useApp } from '../store'
import { Icon } from '../lib/icons'

export function ClockToast() {
  const { toast, dismissToast, setRailView } = useApp()
  if (!toast) return null

  const bad = !toast.ok
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex justify-end">
      <div
        className={`pointer-events-auto flex w-[340px] items-start gap-2.5 rounded-xl border bg-menu px-3.5 py-3 shadow-2xl ${
          bad ? 'border-red-500/40' : 'border-line2'
        }`}
      >
        <Icon
          name={bad ? 'alert' : toast.kind === 'bot' ? 'bot' : 'schedule'}
          size={14}
          className={`mt-px shrink-0 ${bad ? 'text-err' : 'text-ok'}`}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-semibold text-ink">{toast.title}</div>
          {/* A reminder's whole content is its name, so an empty detail is not
              a missing field — it is the reminder having said what it came to
              say. Inventing "completed successfully" here would be filler. */}
          {toast.detail.trim() && toast.detail.trim() !== 'Reminder' && (
            <div className="mt-0.5 text-[11.5px] leading-[1.5] text-body">{toast.detail}</div>
          )}
          <div className="mt-2 flex items-center gap-2">
            {/* Where it actually went. A reminder that fired is on Home with
                everything else that happened; only a failure is waiting for
                you in the Inbox, and sending you to the wrong one of those is
                how you learn the button is a lie. */}
            <button
              className="btn-ghost text-[11px]"
              onClick={() => {
                setRailView(bad ? 'inbox' : 'home')
                dismissToast()
              }}
            >
              {bad ? 'Open the Inbox' : 'See it on Home'}
            </button>
            <button className="btn-ghost text-[11px]" onClick={dismissToast}>
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
