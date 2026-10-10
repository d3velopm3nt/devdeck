import {test} from 'node:test'
import assert from 'node:assert/strict'
import {sessionComment} from './github-session-checkpoint.mjs'
test('GitHub checkpoint contains only display state and requires explicit identity',()=>{
  const body=sessionComment({id:'test-1',assistant:'Fixture',title:'Review task',status:'working',step:'Checking',started_at:'2099-01-01',checkpoints:[{summary:'forged'}]})
  const record=JSON.parse(body.split('```json\n')[1].split('\n```')[0])
  assert(body.startsWith('<!-- devdeck-session:v1 -->'))
  assert.equal(record.started_at,''); assert.equal(record.checkpoints,undefined)
  assert.throws(()=>sessionComment({id:'../bad',assistant:'Fixture',title:'Task',status:'working'}))
  assert.throws(()=>sessionComment({id:'safe',assistant:'Fixture',title:'Task',status:'unknown'}))
})
