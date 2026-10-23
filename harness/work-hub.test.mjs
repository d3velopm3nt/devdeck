import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assembleWork, workState, stepLevels, isTemplate, isExecutionGoal, workDisplayState } from '../src/lib/workHub.ts'
const step = (id, needs = [], status = 'pending') => ({ id, needs, title:id, worker:'builder', target:3, instructions:'Verify', status, claim:'', run:'', evidence:'', previous_runs:[] })
const workflow = (id, steps, ticket_url = '') => ({ node:3, id, folder:'Project', view:{ definition:{title:id,steps,ticket_url},body:'',raw:'',path:'' } })
const record = { id:'request', node:3, title:'A request', description:'', acceptance:'- [ ] Verified', goal:'', source_url:'https://github.com/owner/repo/issues/1', status:'queued', revision:1, runs:[] }
test('multiple workflow instances stay under one item without duplicating intake', () => {
  const monitor = { sources:[{ repository:'owner/repo',items:[{number:1,title:'Issue title',body:'Original request',state:'open'}] }], bindings:[{repository:'owner/repo',node:3}], dispatches:[] }
  const cards = assembleWork([record], [], monitor, [workflow('one',[step('a')],record.source_url),workflow('two',[step('b')],record.source_url)])
  assert.equal(cards.length,1)
  assert.equal(cards[0].workflows.length,2)
  const historical = assembleWork([], [], null, [workflow('one',[step('a')],record.source_url),workflow('two',[step('b')],record.source_url)])
  assert.equal(historical.length,1,'uncached issue history also groups runs under one request')
  assert.equal(historical[0].workflows.length,2)
})
test('run acceptance is independent from work-item completion', () => {
  const done = workflow('one',[step('a',[],'done')],record.source_url)
  const [card] = assembleWork([record],[],null,[done])
  assert.equal(workState(card),'working')
  assert.equal(workState({...card,record:{...record,status:'completed'}}),'completed')
  card.workflows.push(workflow('two',[step('b',[],'review')],record.source_url))
  assert.equal(workState(card),'review')
  card.workflows[1].view.definition.steps[0].status='blocked'
  assert.equal(workState(card),'blocked')
})
test('live claims match full legacy identity; stale and foreign claims do not claim another request', () => {
  const feature = { project_id:'3',feature_id:'feature',feature_name:'Goal',items:[{id:'item',title:'Legacy',status:'pending'}] }
  const claim = { project_id:'3',feature_id:'feature',work_item_id:'item',agent_id:'qa',status:'active' }
  assert.equal(workState(assembleWork([], [feature], null, [], [claim])[0]),'working')
  assert.equal(workState(assembleWork([], [feature], null, [], [{...claim,project_id:'4'}])[0]),'queued')
  assert.equal(workState(assembleWork([], [feature], null, [], [{...claim,status:'released'}])[0]),'queued')
})
test('parallel branches, joins and cycles have distinct graph levels', () => {
  const levels = stepLevels([step('plan'),step('build',['plan']),step('verify',['build']),step('review',['build']),step('deliver',['verify','review'])])
  assert.equal(levels.get('verify'),levels.get('review'))
  assert.equal(levels.get('deliver'),3)
  assert.equal(stepLevels([step('a',['b']),step('b',['a'])]).size,0)
})
test('existing receipts are retained and never offered as reusable templates', () => {
  const old = workflow('old-run',[step('done',[],'done')])
  assert.equal(assembleWork([],[],null,[old])[0].workflows[0],old)
  assert.equal(isTemplate(old),false)
  assert.equal(isTemplate(workflow('work-run-123',[step('start')])),false)
  assert.equal(isTemplate(workflow('template',[step('start')])),true)
})

test('native execution records are not user goals; similarly named goals remain visible', () => {
  const goal = {feature_name:'native_1a14452c7801',goal:'Execute this workflow step using your existing model connection and native DevDeck tools.'}
  assert.equal(isExecutionGoal(goal),true)
  assert.equal(isExecutionGoal({...goal,goal:'Improve native rendering'}),false)
  assert.equal(isExecutionGoal({...goal,feature_name:'Real outcome'}),false)
})

test('discovered open issues enter Intake with the pickup reason and leave it when linked', () => {
  const monitor = {enabled:true,dispatch_enabled:false,sources:[{repository:'owner/repo',items:[{number:1,title:'Unassigned',state:'open'},{number:2,title:'Closed',state:'closed'},{number:3,title:'PR',state:'open',pull_request:true}]}],bindings:[{repository:'owner/repo',node:3,issues:[9]}],dispatches:[]}
  const cards = assembleWork([],[],monitor,[])
  assert.equal(cards.length,1)
  assert.equal(cards[0].intake,'Automatic pickup paused')
  assert.equal(assembleWork([],[],{...monitor,dispatch_enabled:true},[])[0].intake,'Outside the configured issue scope')
  const ready={...monitor,dispatch_enabled:true,bindings:[{repository:'owner/repo',node:3,issues:[1]}]}
  assert.equal(assembleWork([],[],ready,[])[0].intake,'Waiting for automatic pickup')
  const linked=assembleWork([],[],ready,[workflow('run',[step('plan')],record.source_url)])
  assert.equal(linked.length,1)
  assert.equal(linked[0].intake,undefined)
  assert.equal(assembleWork([record],[],ready,[])[0].intake,undefined)
})

test('requested revisions remain distinct from execution failures', () => {
  const request = step('plan', [], 'blocked'); request.next_action = 'Address the review notes and submit again.'
  const card = {...assembleWork([record],[],null,[])[0],workflows:[workflow('one',[request])]}
  assert.equal(workDisplayState(card),'changes_requested')
  card.workflows[0].view.definition.steps.push(step('build', [], 'blocked'))
  assert.equal(workDisplayState(card),'blocked')
})
