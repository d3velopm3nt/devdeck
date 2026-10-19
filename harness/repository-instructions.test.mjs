import assert from 'node:assert/strict'
import { test } from 'node:test'
import { suggestWorkflow, workflowFromInstructions, agentFromInstructions, matchingSkills, readRepositoryInstructions, instructionOrigin } from '../src/lib/repositoryInstructions.ts'

const text = '# Agent workflow\n\nKeep conditional work conditional.\n\n## Workflow\n\n1. **Isolate.** Keep the assigned branch.\n   Preserve other work.\n2. **Build.** Follow existing conventions.\n\n```sh\n3. This is code, not another step.\n```\n3. **Prove.** Check behavior.\n4. **Ship.** Only when requested.\n\n## Completing a task\n1. This belongs to another section.\n'
const source = { repo: 'author/skills', commit: 'a'.repeat(40), path: 'AGENTS.md', text }
test('extracts only the explicit workflow and preserves multiline text and code', () => {
  const steps = suggestWorkflow(text)
  assert.deepEqual(steps.map(s => s.title), ['Isolate', 'Build', 'Prove', 'Ship'])
  assert.match(steps[0].instructions, /Preserve other work/)
  assert.match(steps[1].instructions, /```sh\n3\. This is code/)
  assert(!steps.some(s => s.instructions.includes('another section')))
  assert.deepEqual(suggestWorkflow('# Instructions\n1. An arbitrary list.'), [])
  assert.deepEqual(suggestWorkflow('```md\n## Workflow\n1. Example\n```'), [])
})
test('reviewed order becomes dependencies; source and conditions survive serialization', () => {
  const steps = suggestWorkflow(text).reverse().slice(0, 3)
  const raw = workflowFromInstructions(source, 'A title: "quotes"', steps, 'worker-one', 42)
  const definition = JSON.parse(raw.split('\n---\n')[0].slice(4))
  assert.equal(definition.title, 'A title: "quotes"')
  assert.deepEqual(definition.steps.map(s => s.needs), [[], [steps[0].id], [steps[1].id]])
  assert(definition.steps.every(s => s.target === 42 && s.worker === 'worker-one' && !s.run && !s.status))
  assert(raw.includes(text))
  assert(raw.includes(`/blob/${source.commit}/AGENTS.md`))
})
test('agent creation uses the existing new-agent path and preserves source exactly', () => {
  const agent = agentFromInstructions(source, 'Original agent', ['isolation'], 'sonnet')
  assert.equal(agent.handle, '', 'empty handle requests collision-safe creation rather than update')
  assert(agent.body.endsWith(text))
  assert.deepEqual(agent.skills, ['isolation'])
  assert.equal(agent.unattended, false)
  assert.deepEqual(agent.allow, [])
  assert.deepEqual(instructionOrigin(agent.body), { repo: source.repo, commit: source.commit, path: 'AGENTS.md' })
  assert.equal(instructionOrigin('Some prose mentioning https://github.com/author/skills'), null)
})
test('skill bindings require repository, revision and path, not just a matching ID', () => {
  const item = { kind: 'skill', id: 'isolation', path: 'isolation/SKILL.md', repo: source.repo, commit: source.commit }
  const src = { ...source, items: [item] }
  assert.equal(matchingSkills(src, [item]).size, 1)
  for (const patch of [{ repo: 'other/skills' }, { commit: 'b'.repeat(40) }, { path: 'different/SKILL.md' }]) assert.equal(matchingSkills(src, [{ ...item, ...patch }]).size, 0)
})
test('repository read pins the revision, decodes UTF-8 and distinguishes missing from errors', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async url => { assert(String(url).endsWith(`?ref=${source.commit}`)); return Response.json({ encoding: 'base64', size: 8, content: Buffer.from('café ✓').toString('base64') }) }
    assert.equal((await readRepositoryInstructions(source.repo, source.commit, new AbortController().signal)).text, 'café ✓')
    globalThis.fetch = async () => new Response('', { status: 404 })
    assert.equal(await readRepositoryInstructions(source.repo, source.commit, new AbortController().signal), null)
    globalThis.fetch = async () => new Response('', { status: 403 })
    await assert.rejects(readRepositoryInstructions(source.repo, source.commit, new AbortController().signal), /403/)
    globalThis.fetch = async () => Response.json({ encoding: 'base64', size: 200001, content: '' })
    await assert.rejects(readRepositoryInstructions(source.repo, source.commit, new AbortController().signal), /200 KB/)
  } finally { globalThis.fetch = original }
})
