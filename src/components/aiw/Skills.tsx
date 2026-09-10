// Skills — shared blocks of instructions.
//
// An agent's file holds what *that* agent is for. A skill holds something
// several of them need to know: how you want commits written, what the house
// style is, which commands are safe. Without this every agent restates it, and
// they drift apart the first time you improve one of them.
//
// A skill is appended to the instructions of any agent that lists it, at load
// time — so editing one here changes every agent using it, immediately.

import { useEffect, useState } from 'react'
import { Icon } from '../../lib/icons'
import { useAiw } from '../../lib/aiwStore'
import { aiw, type SkillFile } from '../../lib/aiw'

export function Skills() {
  const a = useAiw()
  const [skills, setSkills] = useState<SkillFile[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [draft, setDraft] = useState<SkillFile | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = () =>
    aiw
      .skills()
      .then(setSkills)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))

  useEffect(() => {
    void load()
  }, [])

  const edit = (s: SkillFile) => {
    setOpen(s.name)
    setDraft({ ...s })
  }

  const add = () => {
    setOpen('')
    setDraft({ name: '', description: '', body: '' })
  }

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      setSkills(await aiw.saveSkill(draft))
      // Skills are baked into each agent's instructions at load, so the team
      // has to be reloaded for an edit to reach it.
      await a.reloadAgents()
      setOpen(draft.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (name: string) => {
    if (!confirm(`Delete the "${name}" skill? Agents using it lose those instructions.`)) return
    try {
      setSkills(await aiw.deleteSkill(name))
      await a.reloadAgents()
      setOpen(null)
      setDraft(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // Which agents would change if this skill did. Worth knowing before editing.
  const usedBy = (name: string) => a.agents.filter((x) => x.skills.includes(name))

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-baseline gap-2.5 border-b border-line px-5 pb-3 pt-3.5">
        <span className="text-[18px] font-semibold tracking-[-0.01em] text-ink">Skills</span>
        <span className="text-[12px] text-dim">
          Instructions several agents share, instead of each restating them.
        </span>
        <button className="btn-primary ml-auto text-[11.5px]" onClick={add}>
          <Icon name="add" size={12} /> New skill
        </button>
      </div>

      {error && (
        <div className="shrink-0 border-b border-red-500/30 bg-red-500/5 px-5 py-2 text-[11.5px] text-err">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 overflow-auto border-r border-line">
          {skills.length === 0 && open === null && (
            <div className="px-4 py-4 text-[11.5px] leading-[1.6] text-muted">
              No skills yet. A good first one is how you want commit messages written — every
              agent that commits needs it, and none of them should have to guess.
            </div>
          )}
          {skills.map((s) => (
            <button
              key={s.name}
              className={`flex w-full flex-col items-start gap-0.5 border-b border-line px-4 py-2.5 text-left ${
                open === s.name ? 'bg-hover' : 'hover:bg-soft'
              }`}
              onClick={() => edit(s)}
            >
              <span className="truncate text-[12px] font-medium text-ink">{s.name}</span>
              <span className="line-clamp-2 text-[10.5px] leading-[1.45] text-muted">
                {s.description || s.body.split('\n')[0] || 'No description'}
              </span>
              {usedBy(s.name).length > 0 && (
                <span className="mt-0.5 text-[9.5px] text-faint">
                  {usedBy(s.name).length} agent{usedBy(s.name).length === 1 ? '' : 's'}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-auto p-5">
          {!draft ? (
            <div className="mt-16 text-center text-[12px] text-muted">
              Pick a skill, or add one.
            </div>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col">
                  <div className="text-[11.5px] font-medium text-dim">Name</div>
                  <input
                    className="input mt-1 w-full font-mono text-[11.5px]"
                    value={draft.name}
                    placeholder="commit-style"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                  <div className="mt-0.5 text-[10.5px] text-faint">
                    Also the file name. Renaming makes a new skill.
                  </div>
                </div>
                <div className="flex flex-col">
                  <div className="text-[11.5px] font-medium text-dim">Description</div>
                  <input
                    className="input mt-1 w-full text-[12px]"
                    value={draft.description}
                    placeholder="How commit messages should read"
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                  <div className="mt-0.5 text-[10.5px] text-faint">
                    Shown when picking skills for an agent.
                  </div>
                </div>
              </div>

              <div>
                <div className="text-[11.5px] font-medium text-dim">Instructions</div>
                <div className="mt-0.5 text-[10.5px] leading-[1.5] text-faint">
                  Appended to the instructions of every agent that uses this. Plain Markdown.
                </div>
                <textarea
                  className="input mt-1.5 h-80 w-full resize-y font-mono text-[11.5px] leading-[1.6]"
                  value={draft.body}
                  placeholder={'Write commit messages in the imperative mood.\nExplain why, not what — the diff already says what.'}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                />
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  className="btn-primary text-[11.5px]"
                  disabled={saving || !draft.name.trim()}
                  onClick={() => void save()}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
                {open && (
                  <button
                    className="rounded border border-red-500/40 px-2.5 py-1 text-[11.5px] text-err hover:bg-red-500/10"
                    onClick={() => void remove(open)}
                  >
                    Delete
                  </button>
                )}
                {open && usedBy(open).length > 0 && (
                  <span className="text-[10.5px] text-faint">
                    Used by {usedBy(open).map((x) => x.name).join(', ')} — saving updates them.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
