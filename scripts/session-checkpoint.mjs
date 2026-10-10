#!/usr/bin/env node
// One record per conversation. Run against a synced state vault, then commit
// and push normally. Never force-push: Git handles remote concurrent edits.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export const revision = content => createHash('sha256').update(content).digest('hex')
export function checkpoint(vault, input, expected = '') {
  if (!/^[A-Za-z0-9_-]+$/.test(input.id || '')) throw new Error('A safe unique session ID is required.')
  const dir = path.join(vault, '.devdeck', 'sessions')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${input.id}.json`)
  // Exclusive lock protects local simultaneous writers. Failure is explicit;
  // no stale-lock auto-delete that could interrupt another process.
  const lock = `${file}.lock`
  const fd = fs.openSync(lock, 'wx')
  try {
    const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    if ((old ? revision(old) : '') !== expected) throw new Error('Session changed. Read its current revision before checkpointing.')
    const previous = old ? JSON.parse(old) : null
    if (previous && previous.assistant !== input.assistant) throw new Error('Use a new session ID for a different assistant; link the same ticket.')
    const now = new Date().toISOString()
    const record = {
      id: input.id, assistant: input.assistant, product_id: input.product_id || '', space: input.space || '', folder: input.folder || '',
      title: input.title, status: input.status || 'working', started_at: previous?.started_at || now, updated_at: now,
      ticket_url: input.ticket_url || '', conversation_url: input.conversation_url || '', step: input.step || '',
      blocker: input.blocker || '', next_action: input.next_action || '',
      checkpoints: [...(previous?.checkpoints || []), { at: now, summary: input.summary || input.title, evidence: input.evidence || [] }],
    }
    if (!record.assistant || !record.title) throw new Error('Assistant and task title are required.')
    if (!['queued','planning','working','waiting','reviewing','blocked','completed','failed','idle'].includes(record.status)) throw new Error('Unknown session status.')
    const content = `${JSON.stringify(record, null, 2)}\n`
    const temporary = `${file}.tmp`
    fs.writeFileSync(temporary, content, { flag: 'wx' })
    try { fs.renameSync(temporary, file) } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
    return { file, revision: revision(content), record }
  } finally { fs.closeSync(fd); fs.unlinkSync(lock) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [vault, inputFile, expected = ''] = process.argv.slice(2)
  if (!vault || !inputFile) { console.error('Usage: node scripts/session-checkpoint.mjs VAULT INPUT_JSON [EXPECTED_SHA256]'); process.exitCode = 1 }
  else {
    try { const result = checkpoint(vault, JSON.parse(fs.readFileSync(inputFile, 'utf8')), expected); console.log(JSON.stringify({file:result.file, revision:result.revision})) }
    catch (e) { console.error(e.message); process.exitCode = 1 }
  }
}
