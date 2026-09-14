// A node, as a conversation.
//
// Every level of the tree has one — a workspace, a folder, a repo-backed
// project — and clicking any of them opens this. What changes with depth is
// what there is to say, not whether you can say it:
//
//   * **A project owns a commit.** Its context is the real thing: files,
//     decisions, what changed since you last looked.
//   * **A parent owns none.** So it rolls its children up as *headlines* —
//     who has a bot, how much is open — and says outright that it has no
//     repository up there. Answering as though it had read code it never saw
//     is the failure this design exists to avoid.
//
// The chips under the name are what the node *is*: its branch, what runs in
// it, who watches it. Everything it *has* — commands, services, settings, the
// dashboard — is one click away rather than five rows in the tree.

import { useEffect, useMemo, useState } from 'react'
import { CAPTURE_NODE_TAB } from '../../lib/devCapture'
import type { IDockviewPanelProps } from 'dockview-react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { useAiw } from '../../lib/aiwStore'
import { Icon } from '../../lib/icons'
import { avatarLabel, nodeColor } from '../../lib/spaces'
import { findNode, resolveDir, subtreeIds, workspaceOf } from '../../lib/tree'
import { openAiwDoc, openBot, openNodeConfig, openNodeSetup, openSpace } from '../../lib/dock'
import { Thread } from '../thread/Thread'
import { NodeFiles } from './NodeFiles'
import { NodeReminders } from './NodeReminders'
import { NodeAside } from './NodeAside'
import { NodeRuns } from './NodeRuns'
import { Git } from '../aiw/AiWorkspace'

/// What a node's page can show about it.
///
/// Which of these exist depends on what the node *is*, not on a fixed set with
/// some of them greyed out: a folder with no repository has no Git tab at all,
/// rather than a Git tab that apologises. That is the whole point of the shape
/// — a client is not a deficient project.
type Tab = 'thread' | 'known' | 'files' | 'git' | 'services' | 'commands' | 'reminders'

/// Git, pointed at this node first.
///
/// The Assistant keeps one selected project and `Git` reads it, so opening
/// this tab has to claim it — exactly what the dock panel does when it becomes
/// active. Without the claim the tab would quietly draw another project's
/// branches, which is the worst possible way to be wrong about a repository.
function GitTab({ nodeId }: { nodeId: number }) {
  const selectProject = useAiw((s) => s.selectProject)
  const current = useAiw((s) => s.projectId)
  useEffect(() => {
    if (current !== String(nodeId)) void selectProject(String(nodeId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <Git />
    </div>
  )
}

export function NodePage({ params }: IDockviewPanelProps<{ id: number }>) {
  const nodeId = params.id
  const { nodes, commands, services, gitByNode, bots, refreshBots } = useApp()
  const a = useAiw()
  const [dir, setDir] = useState('')
  const [tab, setTab] = useState<Tab>((CAPTURE_NODE_TAB as Tab) || 'thread')
  const [reminders, setReminders] = useState(0)
  // What is known about this space: kept facts and setup answers, read the
  // way its manager reads them. A tab only when there is something in it.
  const [known, setKnown] = useState<ipc.KnownNote[]>([])

  useEffect(() => {
    void ipc.vaultDir(nodeId).then(setDir).catch(() => setDir(''))
    // Only for the badge. A tab that says how many is worth a list read; a
    // tab that says nothing until you open it is one you never open.
    void ipc
      .schedulesList()
      .then((all) => setReminders(all.filter((x) => x.node_id === nodeId && x.kind === 'reminder').length))
      .catch(() => setReminders(0))
    void refreshBots()
    void a.loadAllWork()
    void ipc.learnNotes(nodeId).then(setKnown).catch(() => setKnown([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId])

  const node = findNode(nodes, nodeId)
  const parent = node ? findNode(nodes, node.parent_id) : null
  const ws = workspaceOf(nodes, node)
  const bot = bots.find((b) => b.node_id === nodeId)
  const git = gitByNode[nodeId]

  const counts = useMemo(() => {
    if (!node) return { cmds: 0, svcs: 0, kids: 0, open: 0 }
    const scope = new Set(subtreeIds(nodes, node.id))
    const open = a.allWork
      .filter((f) => scope.has(Number(f.project_id)))
      .flatMap((f) => f.items)
      .filter((i) => i.status !== 'done').length
    return {
      cmds: commands.filter((c) => c.project_id === node.id).length,
      svcs: services.filter((s) => s.project_id === node.id).length,
      kids: nodes.filter((n) => n.parent_id === node.id).length,
      open,
    }
  }, [node, nodes, commands, services, a.allWork])

  if (!node) {
    return (
      <div className="flex h-full items-center justify-center bg-page text-[12.5px] text-muted">
        That node no longer exists.
      </div>
    )
  }

  const isProject = node.kind === 'project'
  const TABS: { id: Tab; label: string; when: boolean; count?: number }[] = [
    { id: 'thread', label: 'Thread', when: true },
    { id: 'known', label: 'Known', when: known.length > 0, count: known.length },
    { id: 'files', label: 'Files', when: true },
    // Only where there is a repository to be behind. A vault folder has no
    // branch, and a Git tab over it would be a question with no answer.
    { id: 'git', label: 'Git', when: isProject && !!git?.branch, count: git?.behind || undefined },
    // Only where there are any. A tab that opens on "none configured" is a
    // door to an empty room, and the node's settings is where you add one.
    { id: 'services', label: 'Services', when: counts.svcs > 0, count: counts.svcs },
    { id: 'commands', label: 'Commands', when: counts.cmds > 0, count: counts.cmds },
    { id: 'reminders', label: 'Reminders', when: true, count: reminders || undefined },
  ]
  const chips: { text: string; tone?: string; dashed?: boolean }[] = [
    ...(git?.branch ? [{ text: git.branch }] : []),
    ...(counts.kids ? [{ text: `${counts.kids} folder${counts.kids === 1 ? '' : 's'}` }] : []),
    ...(counts.cmds ? [{ text: `${counts.cmds} command${counts.cmds === 1 ? '' : 's'}` }] : []),
    ...(counts.svcs ? [{ text: `${counts.svcs} service${counts.svcs === 1 ? '' : 's'}` }] : []),
    ...(bot ? [{ text: bot.name, tone: 'text-indigo-400' }] : [{ text: 'no bot', dashed: true }]),
    ...(counts.open ? [{ text: `${counts.open} open item${counts.open === 1 ? '' : 's'}` }] : []),
    ...(isProject
      ? dir
        ? [{ text: dir, dashed: true }]
        : []
      : [{ text: 'no repository of its own', dashed: true, tone: 'text-muted' }]),
  ]

  return (
    <div className="flex h-full min-h-0 flex-col bg-page">
      <div className="shrink-0 border-b border-line px-5 py-3">
        <div className="flex items-start gap-3">
          <span
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-[10px] font-bold text-black/80"
            style={{ background: nodeColor(node) }}
          >
            {avatarLabel(node.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-2">
              {parent && <span className="text-[11.5px] text-muted">{parent.name} /</span>}
              <span className="text-[15px] font-semibold text-ink">{node.name}</span>
              {node.label && (
                <span className="rounded-full bg-indigo-500/15 px-2 text-[9px] font-semibold uppercase tracking-[0.04em] text-indigo-400">
                  {node.label}
                </span>
              )}
              {ws && ws.id !== node.id && (
                <span className="text-[10.5px] text-faint">{ws.name}</span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {chips.map((c, i) => (
                <span
                  key={i}
                  className={`rounded-full border px-2 py-px text-[10.5px] ${
                    c.dashed ? 'border-dashed border-line2 text-faint' : 'border-line text-muted'
                  } ${c.tone ?? ''}`}
                >
                  {c.text}
                </span>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {bot ? (
              <button className="btn-ghost text-[11px]" onClick={() => openBot(bot.node_id, bot.name)}>
                <Icon name="bot" size={12} /> Its bot
              </button>
            ) : null}
            {isProject && (
              <>
                <button
                  className="btn-ghost text-[11px]"
                  onClick={() => openAiwDoc('context', String(nodeId), node.name)}
                >
                  Context
                </button>
                <button
                  className="btn-ghost text-[11px]"
                  onClick={() => openAiwDoc('git', String(nodeId), node.name)}
                >
                  Git
                </button>
                <button className="btn-ghost text-[11px]" onClick={() => openSpace(nodeId, node.name)}>
                  Dashboard
                </button>
              </>
            )}
            <button
              className="btn-ghost text-[11px]"
              onClick={() => (isProject ? openNodeSetup(nodeId, node.name) : openNodeConfig(nodeId, node.name))}
            >
              <Icon name="settings" size={12} /> Settings
            </button>
          </div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-b border-line px-5 pb-2 pt-2">
        {TABS.filter((t) => t.when).map((t) => (
          <button
            key={t.id}
            className={`rounded-md px-2.5 py-1 text-[12px] ${
              tab === t.id ? 'bg-raise text-ink' : 'text-dim hover:bg-hover/50 hover:text-ink'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count ? (
              <span className="ml-1.5 text-[10px] tabular-nums text-faint">{t.count}</span>
            ) : null}
          </button>
        ))}
        <span className="flex-1" />
        {/* Said once, here, rather than as a banner over an empty Git panel.
            A folder without a repository is finished, not broken. */}
        {!isProject && (
          <span className="text-[10.5px] text-faint">
            A folder in your vault &mdash; no code here
          </span>
        )}
      </div>

      {tab === 'files' && (
        <div className="min-h-0 flex-1 px-5 py-3">
          <NodeFiles nodeId={nodeId} hasRepo={isProject} />
        </div>
      )}

      {(tab === 'services' || tab === 'commands') && (
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          <NodeRuns node={node} only={tab} />
        </div>
      )}

      {tab === 'reminders' && (
        <div className="min-h-0 flex-1 overflow-auto px-5 py-3">
          <NodeReminders nodeId={nodeId} />
        </div>
      )}

      {tab === 'known' && (
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="grid max-w-[980px] grid-cols-2 gap-3">
            {known.map((k) => (
              <div key={k.name} className="rounded-lg border border-line bg-panel p-3.5">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
                  {k.name}
                </div>
                <div className="whitespace-pre-line text-[12.5px] leading-relaxed text-body">{k.body}</div>
              </div>
            ))}
          </div>
          <p className="mt-4 max-w-[980px] text-[11px] leading-relaxed text-faint">
            The notes in this space&rsquo;s knowledge folder: facts you kept from mail and answers
            you gave at setup. Its manager reads exactly this, and nothing from your personal store.
          </p>
        </div>
      )}

      {/* The Assistant keeps one selected project, so this page points it at
          its own before drawing Git — the same claim the dock panel makes when
          it becomes active, for the same reason. */}
      {tab === 'git' && <GitTab nodeId={nodeId} />}

      <div className={tab === 'thread' ? 'flex min-h-0 flex-1 gap-4 px-5 py-3' : 'hidden'}>
        <div className="flex min-w-0 flex-1 flex-col">
        <Thread
          reloadKey={nodeId}
          // Where a code block's Run opens its terminal: the space's own
          // folder, so `git status` in the chat is about this repository.
          dir={resolveDir(nodes, node)}
          nodeId={nodeId}
          // A bot that names an agent answers as that agent; otherwise the
          // orchestrator does, and the bar under the box says which.
          agentId={bot?.agent?.trim() ? bot.agent : 'assistant'}
          load={() => ipc.nodeThread(nodeId)}
          send={(text) => ipc.nodeThreadSend(nodeId, text)}
          name={bot ? bot.name : 'Assistant'}
          placeholder={`Ask about ${node.name}, or tell it what to do…`}
          footnote={
            isProject
              ? 'This node owns a repository, so it can read the code and the commits under it.'
              : 'No repository up here — it answers from its children’s headlines, and says so.'
          }
          empty={
            <>
              {bot
                ? `${bot.name} watches this space. Its wakes land here as receipts.`
                : 'Nothing watches this space yet. Ask about it, or give it a bot from its settings.'}
            </>
          }
        />
        </div>
        <NodeAside node={node} isProject={isProject} />
      </div>
    </div>
  )
}
