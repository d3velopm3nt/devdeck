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
import type { IDockviewPanelProps } from 'dockview-react'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { useAiw } from '../../lib/aiwStore'
import { Icon } from '../../lib/icons'
import { avatarLabel, nodeColor } from '../../lib/spaces'
import { findNode, resolveDir, subtreeIds, workspaceOf } from '../../lib/tree'
import { openAiwDoc, openBot, openNodeConfig, openNodeSetup, openSpace } from '../../lib/dock'
import { Thread } from '../thread/Thread'

export function NodePage({ params }: IDockviewPanelProps<{ id: number }>) {
  const nodeId = params.id
  const { nodes, commands, services, gitByNode, bots, refreshBots } = useApp()
  const a = useAiw()
  const [dir, setDir] = useState('')

  useEffect(() => {
    void ipc.vaultDir(nodeId).then(setDir).catch(() => setDir(''))
    void refreshBots()
    void a.loadAllWork()
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

      <div className="min-h-0 flex-1 px-5 py-3">
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
    </div>
  )
}
