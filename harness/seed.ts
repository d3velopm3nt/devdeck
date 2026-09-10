// Fixture data for the harness. Shaped exactly like what the Rust commands
// return, so the components are exercised against realistic payloads.
// Names and companies are invented; the two addresses are the real ones the
// module was designed around.

const now = Date.UTC(2026, 8, 6, 9, 42) // fixed clock: screenshots must not drift

const accounts = [
  {
    id: 1, name: 'Dewald', address: 'd3velopm3nt@gmail.com', kind: 'gmail',
    imap_host: 'imap.gmail.com', imap_port: 993, smtp_host: 'smtp.gmail.com', smtp_port: 465,
    username: '', signature: '', is_default: false, sort: 0, created_at: now - 9e8,
    last_sync: now - 120000, last_error: '', has_password: true,
  },
  {
    id: 2, name: 'Dewald · DevelTech', address: 'hello@develtech.co.za', kind: 'imap',
    imap_host: 'mail.develtech.co.za', imap_port: 993,
    smtp_host: 'mail.develtech.co.za', smtp_port: 465,
    username: 'hello@develtech.co.za', signature: 'DevelTech · develtech.co.za',
    is_default: true, sort: 1, created_at: now - 9e8,
    last_sync: now - 120000, last_error: '', has_password: true,
  },
]

const msg = (o: Record<string, unknown>) => ({
  id: 0, account_id: 2, uid: 1, message_id: '<x@y>', thread_key: '', mailbox: 'INBOX',
  from_name: '', from_addr: '', to_addrs: '', cc_addrs: '', subject: '', preview: '',
  ts: now, unread: false, flagged: false, is_bot: false, contact_id: null, node_id: null,
  account_address: 'hello@develtech.co.za', attachments: 0, ...o,
})

const messages = [
  msg({
    id: 1, uid: 101, from_name: 'Riaan Botha', from_addr: 'riaan@northbound.example',
    subject: 'Re: Phase 2 quote — approved, please invoice', thread_key: 'phase 2 quote',
    preview: 'Board signed it off this morning. Send the invoice against PO 4471 and we settle on 30 days.',
    ts: now, unread: true, attachments: 1, contact_id: 2, message_id: '<r1@northbound>',
  }),
  msg({
    id: 2, uid: 102, from_name: 'Lerato Mahlangu', from_addr: 'lerato@sableretail.example',
    subject: 'Sable Retail — October retainer & checkout traces', thread_key: 'sable retail — october retainer & checkout traces',
    preview: 'Signed retainer attached, plus the timeout traces you asked for from Friday night.',
    ts: now - 5_220_000, unread: true, flagged: true, attachments: 3, contact_id: 1,
    message_id: '<l1@sable>',
  }),
  msg({
    id: 3, uid: 103, account_id: 1, account_address: 'd3velopm3nt@gmail.com',
    from_name: 'GitHub', from_addr: 'notifications@github.com', is_bot: true,
    subject: '[d3velopm3nt/tyrex] CI failed on main', thread_key: 'ci failed on main',
    preview: 'build (windows-latest) failed in 2m 14s — cargo test: 1 failing, 0 skipped',
    ts: now - 6_240_000, unread: true, node_id: 3, contact_id: 5,
  }),
  msg({
    id: 4, uid: 104, account_id: 1, account_address: 'd3velopm3nt@gmail.com',
    from_name: 'Sipho Ndlovu', from_addr: 'sipho@northbound.example',
    subject: 'Staging credentials for tyrex', thread_key: 'staging credentials for tyrex',
    preview: 'Rotated this morning. The new pair is in the vault — deliberately not in this mail.',
    ts: now - 76_000_000, attachments: 1, node_id: 3, contact_id: 4,
  }),
  msg({
    id: 5, uid: 105, from_name: 'Anja de Wet', from_addr: 'anja@kruger.example',
    subject: 'Re: Domain and mailbox migration', thread_key: 'domain and mailbox migration',
    preview: 'MX records are live. The old host keeps the archive until the 30th.',
    ts: now - 94_000_000, contact_id: 3,
  }),
  msg({
    id: 6, uid: 106, account_id: 1, account_address: 'd3velopm3nt@gmail.com',
    from_name: 'Sentry', from_addr: 'noreply@sentry.io', is_bot: true,
    subject: 'New issue: TypeError in checkout.ts', thread_key: 'new issue: typeerror in checkout.ts',
    preview: 'Cannot read properties of undefined (reading "total") — 42 events, 11 users affected',
    ts: now - 98_000_000, node_id: 4,
  }),
  msg({
    id: 7, uid: 107, from_name: 'Thabo Nkosi', from_addr: 'thabo@sableretail.example',
    subject: 'Invoice INV-0147 — paid', thread_key: 'invoice inv-0147 — paid',
    preview: 'Payment went out Friday afternoon, proof of payment attached.',
    ts: now - 330_000_000, attachments: 1,
  }),
]

const bodies: Record<number, unknown> = {
  2: {
    id: 2,
    body_text: '',
    body_html:
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' +
      '<tr><td style="background:#0f766e;padding:16px 20px">' +
      '<div style="font-family:Georgia,serif;font-size:17px;font-weight:700;letter-spacing:.04em;color:#fff">SABLE RETAIL</div>' +
      '<div style="margin-top:2px;font-size:11.5px;color:#99f6e4">Retainer proposal · October 2026</div>' +
      '</td></tr></table>' +
      '<div style="padding:16px 20px">' +
      '<p style="margin:0 0 12px">Hi Dewald, the numbers below match what we agreed on the call. ' +
      'Countersign the PDF and we are good to start on the 7th.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:12.5px">' +
      '<tr><td style="border-bottom:1px solid #e2e8f0;padding:7px 0;color:#475569">Sprint capacity — 2 devs × 4 weeks</td>' +
      '<td style="border-bottom:1px solid #e2e8f0;padding:7px 0;text-align:right">R 148 000</td></tr>' +
      '<tr><td style="border-bottom:1px solid #e2e8f0;padding:7px 0;color:#475569">Support &amp; on-call — 20 hrs</td>' +
      '<td style="border-bottom:1px solid #e2e8f0;padding:7px 0;text-align:right">R 24 000</td></tr>' +
      '<tr><td style="padding:7px 0;font-weight:600">Total excl. VAT</td>' +
      '<td style="padding:7px 0;text-align:right;font-weight:600">R 172 000</td></tr></table>' +
      '<p style="margin:14px 0 0"><span style="display:inline-block;border-radius:4px;background:#0f766e;' +
      'padding:8px 16px;font-size:12.5px;font-weight:600;color:#fff">View the full proposal</span></p>' +
      '<p style="margin:16px 0 0">Our ops lead thinks it is the payment gateway rather than us, ' +
      'but I would rather you looked before we go back to them.</p>' +
      '<p style="margin:12px 0 0">Best,<br>Lerato Mahlangu</p></div>',
    raw_headers:
      'Return-Path: <lerato@sableretail.example>\n' +
      'Delivered-To: hello@develtech.co.za\n' +
      'Received: from mail.sableretail.example (196.34.12.8)\n' +
      '  by mx.develtech.co.za with ESMTPS id 4bYq2n; Sun, 6 Sep 2026 08:15:04 +0200\n' +
      'Authentication-Results: mx.develtech.co.za;\n' +
      '  spf=pass  dkim=pass  dmarc=pass\n' +
      'From: Lerato Mahlangu <lerato@sableretail.example>\n' +
      'To: Dewald <hello@develtech.co.za>\n' +
      'Subject: Sable Retail — October retainer & checkout traces\n' +
      'Content-Type: multipart/mixed; boundary="=_2f9c"',
    attachments: [
      { id: 1, message_id: 2, filename: 'Sable-Retainer-Oct.pdf', mime: 'application/pdf', bytes: 253952, part_index: 1, file_path: '' },
      { id: 2, message_id: 2, filename: 'checkout-timeouts.png', mime: 'image/png', bytes: 1258291, part_index: 2, file_path: '' },
      { id: 3, message_id: 2, filename: 'gateway-errors.csv', mime: 'text/csv', bytes: 4096, part_index: 3, file_path: '' },
    ],
  },
}

const defaultBody = (id: number) => ({
  id,
  body_text:
    'Morning Dewald,\n\nThe board signed off Phase 2 this morning — no changes to the scope we\n' +
    'discussed. Please invoice against PO 4471 and we will settle on the usual\n30 days.\n\n' +
    'One ask: can the migration window land on a Sunday? Warehouse runs a full\nshift on Saturdays now.\n\nThanks,\nRiaan',
  body_html: '',
  raw_headers: 'From: Riaan Botha <riaan@northbound.example>\nTo: hello@develtech.co.za\nSubject: Re: Phase 2 quote',
  attachments: [
    { id: 9, message_id: id, filename: 'PO-4471.pdf', mime: 'application/pdf', bytes: 88064, part_index: 1, file_path: '' },
  ],
})

const contacts = [
  { id: 1, name: 'Lerato Mahlangu', email: 'lerato@sableretail.example', alt_email: 'l.mahlangu@sableretail.example', role: 'Head of Digital', company: 'Sable Retail', phone: '+27 82 415 7729', notes: 'Signs off on scope but not on budget — anything over R100k goes via Thabo in finance.', tags: 'decision-maker', node_id: 2, kind: 'person', created_at: now - 9e8, threads: 9, last_ts: now - 5_220_000 },
  { id: 2, name: 'Riaan Botha', email: 'riaan@northbound.example', alt_email: '', role: 'Operations Director', company: 'Northbound Logistics', phone: '+27 83 220 1184', notes: '', tags: 'decision-maker,billing', node_id: 3, kind: 'person', created_at: now - 9e8, threads: 12, last_ts: now },
  { id: 3, name: 'Anja de Wet', email: 'anja@kruger.example', alt_email: '', role: 'IT Manager', company: 'Kruger & Co', phone: '+27 21 447 9920', notes: '', tags: 'technical', node_id: null, kind: 'person', created_at: now - 9e8, threads: 7, last_ts: now - 94_000_000 },
  { id: 4, name: 'Sipho Ndlovu', email: 'sipho@northbound.example', alt_email: '', role: 'DevOps', company: 'Northbound Logistics', phone: '', notes: '', tags: 'technical', node_id: 3, kind: 'person', created_at: now - 9e8, threads: 6, last_ts: now - 76_000_000 },
  { id: 5, name: 'GitHub', email: 'notifications@github.com', alt_email: '', role: '', company: '', phone: '', notes: '', tags: '', node_id: null, kind: 'bot', created_at: now - 9e8, threads: 4, last_ts: now - 6_240_000 },
]

const notes = [
  { id: 1, thread_key: 'sable retail — october retainer & checkout traces', account_id: 2, kind: 'summary', status: 'new', created_at: now - 5_000_000,
    body: '• Retainer is countersigned. Work starts 7 October at R172 000 excl. VAT.\n• Checkout timeouts cluster 19:40–20:10, their peak hour. They suspect the gateway, not us.\n• You owe them a countersigned copy and a first read on the traces.' },
  { id: 2, thread_key: 'sable retail — october retainer & checkout traces', account_id: 2, kind: 'draft', status: 'new', created_at: now - 4_900_000,
    body: 'Hi Lerato,\n\nCountersigned copy attached — we are good for the 7th.\n\nI have had a first look at the traces. The 19:40–20:10 window lines up with your peak, and every failure is the gateway timing out at 30s rather than our checkout falling over. That points at the gateway, not us — I will confirm against our logs tomorrow.' },
  { id: 3, thread_key: 'sable retail — october retainer & checkout traces', account_id: 2, kind: 'action', status: 'accepted', created_at: now - 4_800_000,
    body: 'Linked this thread to Sable Retail and saved 3 attachments to sable-checkout/docs.' },
]

const nodes = [
  { id: 1, parent_id: null, kind: 'workspace', name: 'Innotrack', dir: '', rel_path: '', sort: 0, color: null },
  { id: 2, parent_id: 1, kind: 'project', name: 'sable-checkout', dir: 'C:\\dev\\sable', rel_path: '', sort: 0, color: null },
  { id: 3, parent_id: 1, kind: 'project', name: 'tyrex', dir: 'C:\\dev\\tyrex', rel_path: '', sort: 1, color: null },
  { id: 4, parent_id: 1, kind: 'project', name: 'devdeck', dir: 'C:\\dev\\devdeck', rel_path: '', sort: 2, color: null },
]

const inGroup = (m: ReturnType<typeof msg>, g: string) => {
  if (g === 'unread') return m.mailbox === 'INBOX' && m.unread
  if (g === 'flagged') return m.flagged
  if (g === 'clients') return m.mailbox === 'INBOX' && contacts.some((c) => c.id === m.contact_id && c.node_id != null)
  if (g === 'projects') return m.mailbox === 'INBOX' && m.node_id != null
  if (g === 'bots') return m.mailbox === 'INBOX' && m.is_bot
  if (g === 'sent') return m.mailbox === 'Sent'
  if (g === 'drafts') return m.mailbox === 'Drafts'
  if (g === 'archive') return m.mailbox === 'Archive'
  return m.mailbox === 'INBOX'
}

const countOf = (g: string) => messages.filter((m) => inGroup(m, g)).length
const counts = () => ({
  inbox: countOf('inbox'),
  unread: countOf('unread'),
  flagged: countOf('flagged'),
  clients: countOf('clients'),
  projects: countOf('projects'),
  bots: countOf('bots'),
  sent: countOf('sent'),
  drafts: countOf('drafts'),
  archive: countOf('archive'),
})

export const SEED: Record<string, (a?: Record<string, unknown>) => unknown> = {
  mail_accounts_list: () => accounts,
  mail_counts: () => counts(),
  mail_contacts_list: () => contacts,
  mail_assistant_list: (a) => notes.filter((n) => n.thread_key === a?.threadKey),
  mail_body: (a) => bodies[Number(a?.id)] ?? defaultBody(Number(a?.id)),
  mail_mark_read: () => null,
  mail_set_flag: () => null,
  mail_list: (a) => {
    const q = (a?.query ?? {}) as { group?: string; chip?: string; search?: string; account_id?: number | null }
    const term = (q.search ?? '').trim().toLowerCase()
    return messages.filter((m) => {
      if (!inGroup(m, q.group ?? 'inbox')) return false
      if (q.chip === 'unread' && !m.unread) return false
      if (q.chip === 'flagged' && !m.flagged) return false
      if (q.chip === 'files' && m.attachments === 0) return false
      if (q.account_id != null && m.account_id !== q.account_id) return false
      if (term && !`${m.subject} ${m.from_name} ${m.from_addr} ${m.preview}`.toLowerCase().includes(term)) return false
      return true
    })
  },
  tree_list: () => nodes,
  command_list: () => [],
  service_list: () => [],
  profile_list: () => [],
  shells_detect: () => [{ name: 'PowerShell', command: 'powershell.exe' }],
  layouts_list: () => [],
  terminals_list: () => [],
  activity_list: () => [],
  conn_list: () => [],
  conn_queries_list: () => [],
  svc_states: () => [],
  logs_tail: () => [],
  recents_list: () => [],
  setting_get: () => null,
  setting_set: () => null,
  git_status_all: () => [],
  app_update_info: () => ({ current: '0.3.1', latest: '0.3.1', ok: true, via_scoop: false, scoop_available: true }),
}
