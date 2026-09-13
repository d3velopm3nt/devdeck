// Mail | Contacts, at the top of the list it switches.
//
// It used to sit in the sidebar above the accounts, where it read as a switch
// for the sidebar -- and the sidebar never changed, the list beside it did. Up
// here it sits on the thing it changes, and the account picked in the sidebar
// filters whichever of the two is showing.

import { useApp } from '../store'

export function MailPaneSwitch() {
  const { mailPane, setMailPane, mailContacts } = useApp()
  return (
    <div className="flex gap-1 border-b border-line px-2.5 py-1.5">
      {(['mail', 'contacts'] as const).map((p) => (
        <button
          key={p}
          className={`flex-1 rounded px-2 py-1 text-center text-[11.5px] capitalize ${
            mailPane === p
              ? 'border border-indigo-500 bg-indigo-500/10 text-ink'
              : 'border border-line2 text-dim hover:text-ink'
          }`}
          onClick={() => setMailPane(p)}
        >
          {p}
          {p === 'contacts' && mailContacts.length > 0 && (
            <span className="ml-1.5 font-mono text-[9.5px] text-muted">{mailContacts.length}</span>
          )}
        </button>
      ))}
    </div>
  )
}
