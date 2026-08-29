// Build an agent.
//
// The team used to be a hardcoded list, so "add another developer" meant
// editing the source. Agents are files now — frontmatter the runtime needs,
// body you actually write — and this is the page for one of them.
//
// The instructions get the most room on purpose. Everything else here is a
// dropdown you set once; that box is the agent.

import { useEffect, useState } from 'react'
import { Icon } from '../../lib/icons'
import { useAiw } from '../../lib/aiwStore'
import { aiw, type AgentFile, type SkillFile } from '../../lib/aiw'
import { ModelPicker } from './ModelPicker'

const PERMISSIONS: Array<[string, string]> = [
  ['full', 'Allowed'],
  ['read', 'Look only'],
  ['approval', 'Ask first'],
  ['none', 'Off'],
]

export function AgentEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const a = useAiw()
  const [file, setFile] = useState<AgentFile | null>(null)
  const [skills, setSkills] = useState<SkillFile[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setError(null)
    setDirty(false)
    aiw.agentFile(id).then(setFile).catch((e) => setError(String(e)))
    aiw.skills().then(setSkills).catch(() => setSkills([]))
  }, [id])

  if (error) {
    return (
      <div className="p-5 text-[12px] text-err">
        {error}
        <button className="btn-ghost ml-2 text-[11px]" onClick={onClose}>
          Back
        </button>
      </div>
    )
  }
  if (!file) return <div className="p-5 text-[12px] text-muted">Loading…</div>

  const edit = (patch: Partial<AgentFile>) => {
    setFile({ ...file, ...patch })
    setDirty(true)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await aiw.saveAgent(file)
      await a.reloadAgents()
      setDirty(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-3">
        <button className="btn-ghost text-[11px]" onClick={onClose}>
          <Icon name="chevron-left" size={12} /> Agents
        </button>
        <span className="text-[15px] font-semibold text-ink">{file.name || file.id}</span>
        {file.builtin && (
          <span className="rounded bg-raise px-1.5 text-[10px] text-muted" title="Seeded on first run. Yours to change or delete.">
            built-in
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-[10.5px] text-warn">unsaved</span>}
          <button className="btn-primary text-[11.5px]" disabled={saving || !dirty} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Name">
              <input
                className="input w-full text-[12px]"
                value={file.name}
                onChange={(e) => edit({ name: e.target.value })}
              />
            </Field>
            <Field label="Role" hint="Drives the mock's script; free text otherwise.">
              <input
                className="input w-full text-[12px]"
                value={file.role}
                placeholder="developer"
                onChange={(e) => edit({ role: e.target.value })}
              />
            </Field>
            <Field label="Id" hint="Used in files and events. Changing it makes a new agent.">
              <input
                className="input w-full font-mono text-[11.5px]"
                value={file.id}
                onChange={(e) => edit({ id: e.target.value })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Provider">
              <select
                className="input w-full text-[12px]"
                value={file.provider}
                onChange={(e) => edit({ provider: e.target.value, model: '' })}
              >
                {['mock', 'anthropic', 'openai-compatible'].map((p) => (
                  <option key={p} value={p}>
                    {p === 'mock' ? 'Mock (no AI)' : p}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Model">
              <ModelPicker
                key={file.provider}
                providerId={file.provider}
                value={file.model}
                onChange={(model) => edit({ model })}
              />
            </Field>
          </div>

          <div>
            <Label>Instructions</Label>
            <Hint>
              What this agent is for and how it should behave. This is the body of its file —
              plain Markdown, the same thing you would write by hand.
            </Hint>
            <textarea
              className="input mt-1.5 h-64 w-full resize-y font-mono text-[11.5px] leading-[1.6]"
              value={file.instructions}
              placeholder="You implement work items and keep the shared interfaces coherent."
              onChange={(e) => edit({ instructions: e.target.value })}
            />
          </div>

          <div>
            <Label>Skills</Label>
            <Hint>
              Shared blocks of instructions, appended to the above. One skill can be reused by
              every agent instead of each restating it.
            </Hint>
            {skills.length === 0 ? (
              <div className="mt-1.5 rounded border border-line bg-raise px-3 py-2.5 text-[11.5px] text-muted">
                No skills yet.{' '}
                <button
                  className="text-indigo-300 underline-offset-2 hover:underline"
                  onClick={() => a.setPage('skills')}
                >
                  Add one
                </button>{' '}
                and it becomes available to every agent.
              </div>
            ) : (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {skills.map((sk) => {
                  const on = file.skills.includes(sk.name)
                  return (
                    <button
                      key={sk.name}
                      className={`rounded-full border px-2.5 py-1 text-[11px] ${
                        on
                          ? 'border-indigo-500/50 bg-indigo-500/12 text-indigo-300'
                          : 'border-line2 text-dim hover:text-ink'
                      }`}
                      title={sk.description}
                      onClick={() =>
                        edit({
                          skills: on
                            ? file.skills.filter((x) => x !== sk.name)
                            : [...file.skills, sk.name],
                        })
                      }
                    >
                      {sk.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div>
            <Label>What it may do</Label>
            <Hint>
              Tools are the only way an agent reaches your machine. Anything not granted is
              refused; <span className="text-dim">Ask first</span> stops the agent and checks
              with you.
            </Hint>
            <div className="mt-1.5 overflow-hidden rounded border border-line">
              {a.tools.map((t) => (
                <div
                  key={t.id}
                  className="grid grid-cols-[minmax(0,1fr)_150px] items-center border-b border-line last:border-0 bg-raise"
                >
                  <div className="px-3 py-2">
                    <div className="text-[12px] text-body">{t.name}</div>
                    <div className="mt-0.5 truncate text-[10px] text-muted">{t.description}</div>
                  </div>
                  <div className="px-3 py-2">
                    <select
                      className="input w-full text-[11px]"
                      value={(file.permissions[t.id] ?? 'none').toLowerCase()}
                      onChange={(e) =>
                        edit({ permissions: { ...file.permissions, [t.id]: e.target.value } })
                      }
                    >
                      {PERMISSIONS.map(([v, label]) => (
                        <option key={v} value={v}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {file.id !== 'assistant' && (
            <div className="flex items-center gap-3 border-t border-line pt-4">
              <button
                className="rounded border border-red-500/40 px-2.5 py-1 text-[11.5px] text-err hover:bg-red-500/10"
                onClick={() => {
                  if (!confirm(`Delete ${file.name || file.id}? Its file is removed.`)) return
                  void aiw
                    .deleteAgent(file.id)
                    .then(() => a.reloadAgents())
                    .then(onClose)
                    .catch((e) => setError(String(e)))
                }}
              >
                Delete agent
              </button>
              <span className="text-[10.5px] text-faint">
                Removes the file. Sessions it already ran stay in the history.
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const Label = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[11.5px] font-medium text-dim">{children}</div>
)
const Hint = ({ children }: { children: React.ReactNode }) => (
  <div className="mt-0.5 text-[10.5px] leading-[1.5] text-faint">{children}</div>
)
/// Label, control, then the hint.
///
/// The hint used to sit between the label and the input, so a field with one
/// pushed its control lower than a field without — three inputs in a row, none
/// of them level. Below the control they explain without moving anything.
const Field = ({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) => (
  <div className="flex flex-col">
    <Label>{label}</Label>
    <div className="mt-1">{children}</div>
    {hint && <Hint>{hint}</Hint>}
  </div>
)
