// Contacts — the address book that fills itself. Everyone who mails you
// becomes a contact; linking one to a client (a node in the project tree) is
// the part only you can do, and it is what lets a thread, an invoice and a
// repo find each other.

import { useEffect, useState } from 'react'
import { useApp } from '../store'
import * as ipc from '../lib/ipc'
import { Icon } from '../lib/icons'
import { openLearnRun } from '../lib/dock'
import { fmtAgo } from '../lib/time'
import type { MailContact, MailMessage } from '../lib/types'
import { MailPaneSwitch } from './MailPaneSwitch'

const BLANK: MailContact = {
  id: 0,
  name: '',
  email: '',
  alt_email: '',
  role: '',
  company: '',
  phone: '',
  notes: '',
  tags: '',
  node_id: null,
  kind: 'person',
  created_at: 0,
  threads: 0,
  last_ts: 0,
}

type Group = 'all' | 'reciprocal' | 'linked' | 'unlinked' | 'people' | 'bots'

const GROUPS: Array<{ key: Group; label: string; icon: Parameters<typeof Icon>[0]['name'] }> = [
  { key: 'all', label: 'All contacts', icon: 'contacts' },
  // The one group that is not a filter over what is already on screen: it is
  // ranked, and the ranking is the point.
  { key: 'reciprocal', label: 'People you reply to', icon: 'send' },
  { key: 'linked', label: 'Linked to a client', icon: 'client' },
  { key: 'unlinked', label: 'Not linked yet', icon: 'alert' },
  { key: 'people', label: 'People', icon: 'contacts' },
  { key: 'bots', label: 'Automated', icon: 'bot' },
]

const matches = (c: MailContact, g: Group) =>
  g === 'all'
    ? true
    : g === 'linked'
      ? c.node_id != null
      : g === 'unlinked'
        ? c.node_id == null
        : g === 'bots'
          ? c.kind === 'bot'
          : c.kind === 'person'

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3.5 py-2.5">
      <div className="mb-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
        {label}
      </div>
      <div className="break-words font-mono text-[12px] text-body">{value || '—'}</div>
    </div>
  )
}

export function ContactsView() {
  const {
    mailContacts,
    mailContactSelectedId,
    nodes,
    selectContact,
    saveContact,
    linkContact,
    openCompose,
    mailQuery,
    mailAccounts,
    setMailQuery,
    openContactMessage,
  } = useApp()

  const [group, setGroup] = useState<Group>('all')
  const [search, setSearch] = useState('')
  // Who you actually correspond with, computed locally.
  //
  // A mailbox is mostly noise: a retailer that has sent four hundred messages
  // you never once answered is a subscription, not a person. Having written
  // back is the one signal a sender cannot manufacture, and it is a query over
  // folders already synced — nothing leaves this machine to produce it.
  const [ranked, setRanked] = useState<ipc.Correspondent[]>([])
  const [rankErr, setRankErr] = useState('')
  useEffect(() => {
    if (group !== 'reciprocal') return
    void ipc
      .mailCorrespondents(200)
      .then((r) => {
        setRanked(r)
        setRankErr('')
      })
      // Reported, not swallowed: an empty list and a failed query look
      // identical, and one of them means "you correspond with nobody".
      .catch((e) => setRankErr(String(e)))
  }, [group, mailContacts.length])
  const [editing, setEditing] = useState<MailContact | null>(null)
  const [error, setError] = useState('')

  const term = search.trim().toLowerCase()
  // The ranked view keeps its order, so it filters the ranking rather than the
  // address book. Sorting it by name afterwards would throw away the only
  // thing it knows that the list above does not.
  const rankedIds = new Set(ranked.map((r) => r.contact_id))
  const byRank = new Map(ranked.map((r, i) => [r.contact_id, i]))
  const visible = (
    group === 'reciprocal'
      ? mailContacts
          .filter((c) => rankedIds.has(c.id))
          .sort((a, b) => (byRank.get(a.id) ?? 0) - (byRank.get(b.id) ?? 0))
      : mailContacts
  ).filter(
    (c) =>
      (group === 'reciprocal' || matches(c, group)) &&
      (!term ||
        c.name.toLowerCase().includes(term) ||
        c.email.toLowerCase().includes(term) ||
        c.company.toLowerCase().includes(term)),
  )
  const selected = mailContacts.find((c) => c.id === mailContactSelectedId) ?? null
  const now = Date.now()

  // Close the editor when the selection moves out from under it.
  useEffect(() => setEditing(null), [mailContactSelectedId])

  // Every message with the selected person, in and out, across every account.
  // Fetched per selection rather than held in the store: it is only ever for
  // the one contact on screen.
  const [emails, setEmails] = useState<MailMessage[]>([])
  const [emailsErr, setEmailsErr] = useState('')
  const [emailsLoading, setEmailsLoading] = useState(false)
  useEffect(() => {
    if (mailContactSelectedId == null) {
      setEmails([])
      return
    }
    let live = true
    setEmailsLoading(true)
    setEmailsErr('')
    void ipc
      .mailContactMessages(mailContactSelectedId, 200)
      .then((m) => {
        if (live) setEmails(m)
      })
      // Shown, not swallowed: an empty list and a failed query look the same,
      // and one of them says you have never written to this person.
      .catch((e) => {
        if (!live) return
        setEmails([])
        setEmailsErr(String(e))
      })
      .finally(() => {
        if (live) setEmailsLoading(false)
      })
    return () => {
      live = false
    }
  }, [mailContactSelectedId])

  // Which account the list is filtered to, so the filter is never invisible.
  const filterAccount =
    mailQuery.account_id != null
      ? mailAccounts.find((a) => a.id === mailQuery.account_id)
      : undefined

  const save = async (def: MailContact) => {
    setError('')
    try {
      await saveContact(def)
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // Only real containers make sense as a client: a workspace or a project.
  const linkTargets = nodes.filter((n) => n.kind === 'workspace' || n.kind === 'project')
  const nodeName = (id: number | null) => nodes.find((n) => n.id === id)?.name ?? ''

  return (
    <div className="flex h-full">
      {/* ---- list ---- */}
      <section className="flex w-[400px] shrink-0 flex-col border-r border-line bg-page">
        <MailPaneSwitch />
        {filterAccount && (
          <div className="flex items-center gap-2 border-b border-line bg-indigo-500/5 px-3 py-1.5 text-[11px] text-dim">
            <Icon name="mail" size={11} className="shrink-0 text-indigo-300" />
            <span className="min-w-0 flex-1 truncate">
              People in <span className="text-body">{filterAccount.address}</span>
            </span>
            <button
              className="shrink-0 text-info hover:underline"
              onClick={() => void setMailQuery({ account_id: null })}
            >
              All accounts
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 border-b border-line px-2.5 py-2">
          <div className="flex flex-1 items-center gap-1.5 rounded border border-line2 bg-page px-2 py-1">
            <Icon name="search" size={12} className="text-faint" />
            <input
              className="w-full bg-transparent text-[11.5px] text-ink outline-none placeholder:text-faint"
              placeholder="Search name, company, address"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            className="btn-ghost inline-flex items-center gap-1 text-[11px]"
            onClick={() => {
              selectContact(null)
              setEditing({ ...BLANK })
            }}
          >
            <Icon name="add" size={11} /> Add
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 border-b border-line px-2.5 py-1.5">
          {GROUPS.map((g) => {
            const n = mailContacts.filter((c) => matches(c, g.key)).length
            return (
              <button
                key={g.key}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-[2px] font-mono text-[10px] ${
                  group === g.key
                    ? 'border-transparent bg-indigo-500/20 text-indigo-300'
                    : 'border-line2 text-dim hover:bg-hover/50'
                }`}
                onClick={() => setGroup(g.key)}
              >
                <Icon name={g.icon} size={9} />
                {g.label} · {n}
              </button>
            )
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-1.5">
          {group === 'reciprocal' && (
            <div className="mb-1.5 rounded-lg border border-line bg-panel px-3 py-2 text-[11px] leading-relaxed text-muted">
              Ranked by how often <span className="text-body">you wrote back</span>, not by how much
              they sent. A retailer with four hundred messages you never answered is a
              subscription, not a person. Counted here on this machine.
              {/* The way into the learn run lives here rather than on a toolbar:
                  this ranking is the reason the run is small enough to approve,
                  and the sentence above is the argument for it. */}
              <button
                className="mt-1.5 flex items-center gap-1.5 text-[11px] text-info hover:underline"
                onClick={() => openLearnRun()}
              >
                <Icon name="bot" size={11} /> Read these threads and learn who they are
              </button>
            </div>
          )}
          {rankErr && (
            <div className="mb-1.5 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11.5px] text-err">
              Could not work out who you correspond with: {rankErr}
            </div>
          )}
          {visible.length === 0 && !rankErr && (
            <div className="px-3 py-8 text-center text-[12px] leading-5 text-muted">
              {group === 'reciprocal'
                ? 'Nobody yet. This fills in once your Sent folder has synced.'
                : filterAccount
                  ? `Nobody here from ${filterAccount.address}.`
                  : 'No contacts here yet. They appear on their own as mail arrives.'}
            </div>
          )}
          {visible.map((c) => (
            <button
              key={c.id}
              className={`mb-1.5 block w-full rounded-lg border px-3 py-2.5 text-left ${
                c.id === mailContactSelectedId
                  ? 'border-indigo-500/50 bg-raise'
                  : 'border-line bg-panel hover:border-line3'
              }`}
              onClick={() => selectContact(c.id)}
            >
              <div className="flex items-center gap-2">
                <Icon
                  name={c.kind === 'bot' ? 'bot' : 'contacts'}
                  size={13}
                  className={c.kind === 'bot' ? 'text-viol' : 'text-dim'}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-ink">
                    {c.name || c.email}
                  </span>
                  {c.role && (
                    <span className="block truncate text-[11.5px] text-dim">{c.role}</span>
                  )}
                </span>
                {c.last_ts > 0 && (
                  <span className="shrink-0 font-mono text-[9.5px] text-muted">
                    {fmtAgo(c.last_ts, now)}
                  </span>
                )}
              </div>
              <div className="mt-1.5 truncate font-mono text-[10.5px] text-muted">{c.email}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {c.node_id != null ? (
                  <span className="rounded-full border border-indigo-500/30 px-1.5 py-[1px] font-mono text-[9.5px] text-indigo-300">
                    {nodeName(c.node_id) || 'linked'}
                  </span>
                ) : (
                  <span className="rounded-full border border-line2 px-1.5 py-[1px] font-mono text-[9.5px] text-muted">
                    not linked
                  </span>
                )}
                <span className="rounded-full border border-line2 px-1.5 py-[1px] font-mono text-[9.5px] text-muted">
                  {c.threads} thread{c.threads === 1 ? '' : 's'}
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* ---- detail / editor ---- */}
      <section className="min-w-0 flex-1 overflow-auto bg-page px-5 py-4">
        {error && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-err">
            {error}
          </div>
        )}

        {editing ? (
          <ContactEditor
            draft={editing}
            onChange={setEditing}
            onCancel={() => setEditing(null)}
            onSave={() => void save(editing)}
          />
        ) : !selected ? (
          <div className="flex h-full items-center justify-center text-[12.5px] text-muted">
            Pick a contact, or add one.
          </div>
        ) : (
          <div className="max-w-3xl">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[16px] font-semibold text-ink">
                  {selected.name || selected.email}
                </div>
                <div className="mt-0.5 text-[12.5px] text-dim">
                  {[selected.role, selected.company].filter(Boolean).join(' · ') || 'No company set'}
                </div>
              </div>
              <button
                className="btn-primary inline-flex items-center gap-1.5 text-[12px]"
                onClick={() => openCompose({ to: selected.email })}
              >
                <Icon name="mail" size={12} /> Compose
              </button>
              <button className="btn-ghost text-[12px]" onClick={() => setEditing({ ...selected })}>
                Edit
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <Field label="Work address" value={selected.email} />
              <Field label="Phone" value={selected.phone} />
              <Field label="Also seen as" value={selected.alt_email} />
              <Field
                label="Threads"
                value={`${selected.threads} · ${selected.last_ts ? fmtAgo(selected.last_ts, now) : 'never'}`}
              />
            </div>

            <div className="mb-2 mt-4 flex items-center gap-2">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
                Linked to
              </span>
            </div>
            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 px-3.5 py-3">
              <div className="flex items-center gap-2.5">
                <Icon name="client" size={15} className="text-indigo-300" />
                <span className="min-w-0 flex-1 text-[13px] text-ink">
                  {selected.node_id != null
                    ? nodeName(selected.node_id)
                    : 'Not linked to a client yet'}
                </span>
                <select
                  className="input text-[11.5px]"
                  value={selected.node_id ?? ''}
                  onChange={(e) =>
                    void linkContact(
                      selected.id,
                      e.target.value === '' ? null : Number(e.target.value),
                    )
                  }
                >
                  <option value="">— not linked —</option>
                  {linkTargets.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-2.5 border-t border-indigo-500/20 pt-2.5 text-[12px] leading-[1.6] text-muted">
                A contact is one person; a client is the company you bill. Linking the two is what
                puts their mail in the Clients group.
              </div>
            </div>

            {selected.notes && (
              <div className="mt-4 rounded-lg border border-line bg-panel px-3.5 py-3 text-[12.5px] leading-[1.7] text-body">
                {selected.notes}
              </div>
            )}

            {/* Everything with this person: what they sent, what you sent them,
                and threads they were copied on. Across every account, because
                the person is the filter here, not the mailbox. */}
            <div className="mb-2 mt-5 flex items-center gap-2">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
                Emails
              </span>
              {!emailsLoading && !emailsErr && (
                <span className="font-mono text-[10px] text-faint">
                  {emails.length}
                  {emails.length >= 200 ? '+' : ''}
                </span>
              )}
            </div>
            {emailsErr ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12px] text-err">
                Could not load their mail: {emailsErr}
              </div>
            ) : emailsLoading && emails.length === 0 ? (
              <div className="px-1 text-[12px] text-muted">Loading...</div>
            ) : emails.length === 0 ? (
              <div className="rounded-lg border border-line bg-panel px-3.5 py-3 text-[12px] text-muted">
                No mail with them in what has synced so far.
              </div>
            ) : (
              <div className="overflow-hidden rounded-lg border border-line bg-panel">
                {emails.map((m, i) => {
                  // Yours when it sits in Sent or came from the account itself.
                  const mine =
                    m.mailbox === 'Sent' ||
                    m.from_addr.toLowerCase() === m.account_address.toLowerCase()
                  return (
                    <button
                      key={m.id}
                      className={`flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left hover:bg-hover/50 ${
                        i > 0 ? 'border-t border-line' : ''
                      }`}
                      title={mine ? `You to ${m.to_addrs}` : `From ${m.from_name || m.from_addr}`}
                      onClick={() => void openContactMessage(m)}
                    >
                      <Icon
                        name={mine ? 'send' : 'inbox'}
                        size={12}
                        className={`mt-[3px] shrink-0 ${mine ? 'text-info' : 'text-dim'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-[12.5px] ${
                            m.unread ? 'font-semibold text-ink' : 'text-body'
                          }`}
                        >
                          {m.subject || '(no subject)'}
                        </span>
                        <span className="block truncate text-[11.5px] text-muted">{m.preview}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-mono text-[9.5px] text-muted">
                          {fmtAgo(m.ts, now)}
                        </span>
                        {mailAccounts.length > 1 && (
                          <span className="block max-w-[160px] truncate font-mono text-[9.5px] text-faint">
                            {m.account_address}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function ContactEditor({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: MailContact
  onChange: (c: MailContact) => void
  onCancel: () => void
  onSave: () => void
}) {
  const set = (patch: Partial<MailContact>) => onChange({ ...draft, ...patch })
  const field = (label: string, node: React.ReactNode) => (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-muted">
        {label}
      </span>
      {node}
    </label>
  )

  return (
    <div className="max-w-xl space-y-3.5">
      <div className="text-[15px] font-semibold text-ink">
        {draft.id > 0 ? 'Edit contact' : 'New contact'}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {field(
          'Name',
          <input
            className="input w-full"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
          />,
        )}
        {field(
          'Email',
          <input
            className="input w-full"
            value={draft.email}
            onChange={(e) => set({ email: e.target.value })}
          />,
        )}
        {field(
          'Role',
          <input
            className="input w-full"
            value={draft.role}
            onChange={(e) => set({ role: e.target.value })}
          />,
        )}
        {field(
          'Company',
          <input
            className="input w-full"
            value={draft.company}
            onChange={(e) => set({ company: e.target.value })}
          />,
        )}
        {field(
          'Phone',
          <input
            className="input w-full"
            value={draft.phone}
            onChange={(e) => set({ phone: e.target.value })}
          />,
        )}
        {field(
          'Also seen as',
          <input
            className="input w-full"
            value={draft.alt_email}
            onChange={(e) => set({ alt_email: e.target.value })}
          />,
        )}
      </div>
      {field(
        'Notes',
        <textarea
          className="input h-24 w-full resize-none"
          value={draft.notes}
          onChange={(e) => set({ notes: e.target.value })}
        />,
      )}
      <div className="flex gap-2">
        <button className="btn-primary text-[12px]" onClick={onSave}>
          Save contact
        </button>
        <button className="btn-ghost text-[12px]" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
