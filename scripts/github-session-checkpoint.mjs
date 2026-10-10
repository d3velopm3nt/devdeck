#!/usr/bin/env node
// Generate the explicit GitHub checkpoint envelope; this script does not post it.
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
export function sessionComment(input) {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(input.id || '')) throw Error('Use a unique, safe session ID.')
  if (!input.assistant?.trim() || !input.title?.trim()) throw Error('Assistant and title are required.')
  if (!['planning','working','waiting','blocked','reviewing','completed','failed','idle'].includes(input.status)) throw Error('Choose a supported status.')
  const record = {id:input.id,assistant:input.assistant,title:input.title,status:input.status,product_id:'',space:'',folder:'',started_at:'',updated_at:'',step:input.step || '',blocker:input.blocker || '',next_action:input.next_action || '',conversation_url:input.conversation_url || ''}
  return `<!-- devdeck-session:v1 -->\n\`\`\`json\n${JSON.stringify(record,null,2)}\n\`\`\`\n`
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if(!process.argv[2]) throw Error('Usage: node scripts/github-session-checkpoint.mjs INPUT_JSON'); process.stdout.write(sessionComment(JSON.parse(fs.readFileSync(process.argv[2],'utf8')))) }
  catch(e) { console.error(e.message); process.exitCode=1 }
}
