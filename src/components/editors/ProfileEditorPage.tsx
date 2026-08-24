// Dedicated full-window editor page for a single launch profile.
// Opened as a main-area tab from the Profiles side panel.

import { useMemo, useState } from 'react'
import type { IDockviewPanelProps } from 'dockview-react'
import * as ipc from '../../lib/ipc'
import type { ProfileDef, ProfileStep } from '../../lib/types'
import { useApp } from '../../store'
import { launchProfile } from '../../lib/runner'
import { resolveDir } from '../../lib/tree'
import { EditorShell, Field } from './EditorShell'
import { Icon } from '../../lib/icons'

type Params = { id: number; projectId?: number | null }

function stepLabel(step: ProfileStep, state: ReturnType<typeof useApp.getState>): string {
  switch (step.type) {
    case 'service':
      return `Start service: ${state.services.find((s) => s.id === step.id)?.name ?? step.id}`
    case 'command':
      return `Run command: ${state.commands.find((c) => c.id === step.id)?.name ?? step.id}`
    case 'terminal':
      return `Open terminal${step.shell ? ` (${step.shell.split(/[\\/]/).pop()})` : ''}`
    case 'layout':
      return `Restore layout: ${state.layouts.find((l) => l.id === step.id)?.name ?? step.id}`
  }
}

export function ProfileEditorPage(props: IDockviewPanelProps<Params>) {
  const state = useApp()
  const { profiles, refreshProfiles, selectedNode } = state
  const id = props.params.id

  const initial = useMemo(() => {
    if (id > 0) return profiles.find((p) => p.id === id) ?? null
    return {
      id: 0,
      project_id: props.params.projectId ?? selectedNode()?.id ?? null,
      name: '',
      steps: '[]',
    } as ProfileDef
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const [profile, setProfile] = useState<ProfileDef | null>(initial)
  if (!profile) {
    return <div className="p-6 text-slate-500">Profile not found (it may have been deleted).</div>
  }

  const steps: ProfileStep[] = (() => {
    try {
      return JSON.parse(profile.steps)
    } catch {
      return []
    }
  })()
  const setSteps = (s: ProfileStep[]) => setProfile((p) => ({ ...p!, steps: JSON.stringify(s) }))
  const addStep = (step: ProfileStep) => setSteps([...steps, step])
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= steps.length) return
    const next = [...steps]
    ;[next[i], next[j]] = [next[j], next[i]]
    setSteps(next)
  }

  const save = async () => {
    if (!profile.name.trim()) return
    await ipc.profileSave(profile)
    await refreshProfiles()
    props.api.close()
  }

  const remove = async () => {
    if (!confirm(`Delete profile "${profile.name}"?`)) return
    await ipc.profileDelete(profile.id)
    await refreshProfiles()
    props.api.close()
  }

  return (
    <EditorShell
      icon="service"
      kind="Profile"
      title={id > 0 ? profile.name || 'Profile' : 'New profile'}
      subtitle="One click starts services, runs commands, opens terminals, and restores a layout."
      onCancel={() => props.api.close()}
      onSave={() => void save()}
      canSave={!!profile.name.trim()}
      onDelete={id > 0 ? () => void remove() : undefined}
      extraActions={
        id > 0 && (
          <button className="btn-ghost inline-flex items-center gap-1" onClick={() => void launchProfile(profile)} title="Launch now">
            <Icon name="service" size={14} /> Launch
          </button>
        )
      }
    >
      <Field label="Profile name">
        <input
          className="input w-full"
          placeholder="e.g. Full stack dev"
          value={profile.name}
          onChange={(e) => setProfile((p) => ({ ...p!, name: e.target.value }))}
        />
      </Field>

      <div className="space-y-1 pt-1">
        <span className="text-[11px] font-medium text-slate-500">Steps (run top to bottom)</span>
        {steps.length === 0 && (
          <div className="rounded border border-dashed border-slate-700 px-3 py-4 text-center text-[12px] text-slate-500">
            No steps yet — add them below.
          </div>
        )}
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2 rounded bg-slate-800/40 px-2 py-1.5 text-[12.5px]">
            <span className="w-5 text-[10px] text-slate-500">{i + 1}.</span>
            <span className="flex-1 text-slate-300">{stepLabel(s, state)}</span>
            <button className="inline-flex items-center px-1 text-slate-500 hover:text-white disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
              <Icon name="arrow-up" size={14} />
            </button>
            <button className="inline-flex items-center px-1 text-slate-500 hover:text-white disabled:opacity-30" disabled={i === steps.length - 1} onClick={() => move(i, 1)} title="Move down">
              <Icon name="arrow-down" size={14} />
            </button>
            <button className="px-1 text-slate-500 hover:text-red-400" onClick={() => setSteps(steps.filter((_, j) => j !== i))} title="Remove">
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <select
          className="input text-[12px]"
          value=""
          onChange={(e) => e.target.value && addStep({ type: 'service', id: Number(e.target.value) })}
        >
          <option value="">+ Start service…</option>
          {state.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          className="input text-[12px]"
          value=""
          onChange={(e) => e.target.value && addStep({ type: 'command', id: Number(e.target.value) })}
        >
          <option value="">+ Run command…</option>
          {state.commands.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          className="input text-[12px]"
          value=""
          onChange={(e) =>
            e.target.value &&
            addStep({ type: 'terminal', shell: e.target.value === 'default' ? '' : e.target.value, cwd: resolveDir(state.nodes, selectedNode()) })
          }
        >
          <option value="">+ Open terminal…</option>
          <option value="default">Default shell</option>
          {state.shells.map((s) => (
            <option key={s.command} value={s.command}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          className="input text-[12px]"
          value=""
          onChange={(e) => e.target.value && addStep({ type: 'layout', id: Number(e.target.value) })}
        >
          <option value="">+ Restore layout…</option>
          {state.layouts
            .filter((l) => l.name !== '__autosave__')
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
      </div>
    </EditorShell>
  )
}
