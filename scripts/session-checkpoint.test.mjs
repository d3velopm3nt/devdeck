import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkpoint } from './session-checkpoint.mjs'

test('fresh conversation recovery preserves checkpoints and rejects lost updates', () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'devdeck-session-test-'))
  try {
    const input = { id:'chatgpt-visibility-1', assistant:'ChatGPT', title:'Visibility board', product_id:'devdeck', ticket_url:'https://github.com/d3velopm3nt/devdeck/issues/8', next_action:'Build the board' }
    const first = checkpoint(vault, input)
    const second = checkpoint(vault, {...input,summary:'Board built; checks pending',next_action:'Run handoff checks'},first.revision)
    assert.equal(second.record.checkpoints.length,2)
    assert.equal(second.record.started_at,first.record.started_at)
    assert.throws(() => checkpoint(vault,{...input,summary:'Outdated write'},first.revision),/Session changed/)
    const recovered = JSON.parse(fs.readFileSync(second.file,'utf8'))
    assert.equal(recovered.next_action,'Run handoff checks')
    assert.equal(recovered.ticket_url,input.ticket_url)
    assert.equal(recovered.checkpoints.at(-1).summary,'Board built; checks pending')
    assert.throws(() => checkpoint(vault,{...input,assistant:'Claude'},second.revision),/new session ID/)
    const handoff = checkpoint(vault,{...input,id:'claude-visibility-2',assistant:'Claude',summary:'Read previous checkpoints'})
    assert.equal(handoff.record.ticket_url,recovered.ticket_url)
    assert.throws(() => checkpoint(vault,{...input,id:'../escape'}),/safe unique/)
  } finally { fs.rmSync(vault,{recursive:true,force:true}) }
})
