// Mail's contextual sidebar: accounts, the groups a mailbox is filtered by,
// and the switch between mail and the address book. Fixed chrome like the
// Explorer and the Stash sidebar — no tab chrome, no dock panel.

import { useApp } from '../store'
import { Icon, type IconName } from '../lib/icons'
import { fmtAgo } from '../lib/time'
import type { MailCounts, MailGroup } from '../lib/types'

const GROUPS: Array<{ key: MailGroup; icon: IconName; label: string; tint: string }> = [
  { key: 'inbox', icon: 'inbox', label: 'Inbox', tint: 'text-dim' },
  { key: 'unread', icon: 'mail', label: 'Unread', tint: 'text-indigo-300' },
  { key: 'flagged', icon: 'star', label: 'Flagged', tint: 'text-warn' },
  { key: 'clients', icon: 'client', label: 'Clients', tint: 'text-info' },
  { key: 'projects', icon: 'project', label: 'Projects', tint: 'text-ok' },
  { key: 'bots', icon: 'bot', label: 'Bot & automated', tint: 'text-viol' },
  { key: 'sent', icon: 'send', label: 'Sent', tint: 'text-dim' },
  { key: 'drafts', icon: 'note', label: 'Drafts', tint: 'text-dim' },
  { key: 'archive', icon: 'stash', label: 'Archive', tint: 'text-dim' },
]

const countFor = (c: MailCounts | null, key: MailGroup): number => (c ? c[key] : 0)

function Row({
  icon,
  label,
  tint,
  n,
  active,
  onClick,
}: {
  icon: IconName
  label: string
  tint?: string
  n?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[12.5px] ${
        active ? 'bg-raise text-ink' : 'text-body hover:bg-hover/50'
      }`}
      onClick={onClick}
    >
      <Icon name={icon} size={13} className={active ? undefined : tint} />
      <span className="truncate">{label}</span>
      {n != null && <span className="ml-auto font-mono text-[10px] text-muted">{n}</span>}
    </button>
  )
}

export function MailSidebar() {
  const {
    mailAccounts,
    mailCounts,
    mailQuery,
    mailPane,
    mailSyncing,
    mailContacts,
    setMailQuery,
    setMailPane,
    openMailAccountEditor,
    openCompose,
    syncMail,
  } = useApp()

  const now = Date.now()

  return (
    <div className="flex h-full flex-col bg-app">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Icon name="mail" size={14} className="text-indigo-400" />
        <span className="text-[12.5px] font-semibold text-ink">Mail</span>
        <button
          className="btn-ghost ml-auto inline-flex items-center gap-1 text-[11px]"
          title="Write a new message"
          onClick={() => openCompose()}
        >
          <Icon name="add" size={11} /> Compose
        </button>
      </div>

      {/* Contacts live inside Mail rather than taking a rail slot of their own:
          an address book with no mail in it is a filing cabinet. */}
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

      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        <div className="flex items-center px-2 pb-1 pt-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
          Accounts
          <button
            className="ml-auto normal-case tracking-normal text-muted hover:text-ink disabled:opacity-50"
            title="Fetch new mail for every account"
            disabled={mailSyncing || mailAccounts.length === 0}
            onClick={() => void syncMail()}
          >
            {mailSyncing ? 'syncing…' : 'sync'}
          </button>
        </div>

        {mailAccounts.length === 0 && (
          <div className="px-3 py-4 text-center text-[12px] leading-5 text-muted">
            No accounts yet.
            <br />
            Add one to start fetching mail to this machine.
          </div>
        )}

        {mailAccounts.map((a) => {
          const active = mailQuery.account_id === a.id
          // A row that can only be filtered is a dead end for the account that
          // was typed wrong: the settings that failed are the settings you
          // cannot reach. So the row is a container with two controls in it
          // rather than one button — a button inside a button is not valid
          // markup, and the filter had claimed the whole row.
          const broken = !!a.last_error || !a.has_password
          return (
            <div
              key={a.id}
              className={`group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 ${
                active ? 'bg-raise' : 'hover:bg-hover/50'
              }`}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                title={a.last_error || `${a.address} — click to filter to this account`}
                onClick={() => void setMailQuery({ account_id: active ? null : a.id })}
                onDoubleClick={() => openMailAccountEditor(a.id)}
              >
                {/* Failure honesty: a red dot and the reason, never a silent
                    nothing that looks like an empty inbox. */}
                <span
                  className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                    a.last_error ? 'bg-red-400' : a.has_password ? 'bg-emerald-400' : 'bg-faint'
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] text-body">{a.address}</span>
                  <span
                    className={`block truncate font-mono text-[9.5px] ${
                      a.last_error ? 'text-err' : 'text-faint'
                    }`}
                  >
                    {a.last_error
                      ? a.last_error
                      : a.last_sync
                        ? `synced ${fmtAgo(a.last_sync, now)}`
                        : a.has_password
                          ? 'never synced'
                          : 'no password stored'}
                  </span>
                </span>
              </button>
              {/* Always shown on an account that is not working, hover-only on
                  one that is. Hiding the way out of a failure behind a hover
                  is how the failure became permanent. */}
              <button
                className={`shrink-0 rounded p-1 text-dim hover:bg-hover hover:text-ink ${
                  broken ? 'flex' : 'hidden group-hover:flex'
                }`}
                title={
                  a.last_error
                    ? `Fix the settings for ${a.address}`
                    : `Settings for ${a.address}`
                }
                onClick={() => openMailAccountEditor(a.id)}
              >
                <Icon name="settings" size={12} />
              </button>
            </div>
          )
        })}

        <button
          className="mt-1 flex w-full items-center gap-2 rounded-md border border-dashed border-line2 px-2 py-1.5 text-[11.5px] text-muted hover:border-indigo-500/50 hover:text-dim"
          onClick={() => openMailAccountEditor(0)}
        >
          <Icon name="add" size={11} /> Add account
        </button>

        <div className="px-2 pb-1 pt-3 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
          Groups
        </div>
        {GROUPS.map((g) => (
          <Row
            key={g.key}
            icon={g.icon}
            label={g.label}
            tint={g.tint}
            n={countFor(mailCounts, g.key)}
            active={mailQuery.group === g.key}
            onClick={() => void setMailQuery({ group: g.key })}
          />
        ))}
      </div>
    </div>
  )
}
