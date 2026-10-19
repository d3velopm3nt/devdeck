import { useCallback, useEffect, useRef, useState } from 'react'
import { aiw, type FeatureWork, type GoalRow, type WorkClaim } from '../../lib/aiw'
import * as ipc from '../../lib/ipc'
import type { TreeNode } from '../../lib/types'
import { modelWorker, type WorkflowEntry } from '../../lib/workHub'

interface Data { goals: GoalRow[]; legacy: FeatureWork[]; records: ipc.WorkRecord[]; monitor: ipc.IssueMonitorView | null; workflows: WorkflowEntry[]; workers: ipc.Worker[]; teams: ipc.ReusableTeam[]; claims: WorkClaim[]; errors: string[]; loading: boolean }
const initial: Data = { goals:[], legacy:[], records:[], monitor:null, workflows:[], workers:[], teams:[], claims:[], errors:[], loading:true }
export function useWorkData(nodes: TreeNode[]) {
  const [data, setData] = useState<Data>(initial)
  const generation = useRef(0)
  const invalidate = useCallback(() => { generation.current++ }, [])
  const latestNodes = useRef(nodes); latestNodes.current = nodes
  const folderKey = nodes.map(n => `${n.id}:${n.dir}`).join('|')
  const reload = useCallback(async () => {
    const current = ++generation.current
    setData(old => ({ ...old, loading:true }))
    const results = await Promise.allSettled([ipc.teamBoard(), aiw.allWork(), ipc.workRecordsList(), ipc.issueMonitorGet(), ipc.workersList(), ipc.reusableTeamsList(), aiw.claims(), aiw.agents()])
    if (current !== generation.current) return
    const errors: string[] = []
    const labels = ['Goals', 'Existing work', 'Work items', 'Issue intake', 'Agents', 'Teams', 'Active claims', 'Model agents']
    results.forEach((result, i) => { if (result.status === 'rejected') errors.push(`${labels[i]}: ${String(result.reason)}`) })
    const workflows: WorkflowEntry[] = []
    // Bound reads across folders, rather than launching a request per file at once.
    const folders = latestNodes.current.filter(n => n.dir)
    for (let at = 0; at < folders.length; at += 4) {
      await Promise.all(folders.slice(at, at + 4).map(async folder => {
        try {
          const summaries = await ipc.folderWorkflowList(folder.id)
          for (const summary of summaries) {
            if (summary.error) { errors.push(`${folder.name} / ${summary.title}: ${summary.error}`); continue }
            try { workflows.push({ node:folder.id, id:summary.id, folder:folder.name, view:await ipc.folderWorkflowGet(folder.id, summary.id) }) }
            catch (e) { errors.push(`${folder.name} / ${summary.title}: ${String(e)}`) }
          }
        } catch (e) { errors.push(`${folder.name} workflows: ${String(e)}`) }
      }))
    }
    if (current !== generation.current) return
    setData(old => ({ ...old,
      goals:results[0].status === 'fulfilled' ? results[0].value : old.goals,
      legacy:results[1].status === 'fulfilled' ? results[1].value : old.legacy,
      records:results[2].status === 'fulfilled' ? results[2].value : old.records,
      monitor:results[3].status === 'fulfilled' ? results[3].value : old.monitor,
      workers:[...(results[4].status === 'fulfilled' ? results[4].value : old.workers.filter(w => !w.handle.startsWith('agent:'))), ...(results[7].status === 'fulfilled' ? results[7].value.map(modelWorker) : old.workers.filter(w => w.handle.startsWith('agent:')))],
      teams:results[5].status === 'fulfilled' ? results[5].value : old.teams,
      claims:results[6].status === 'fulfilled' ? results[6].value : old.claims,
      workflows, errors, loading:false,
    }))
  }, [])
  useEffect(() => {
    void reload()
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = aiw.onEvent(event => {
      // Token streaming should not cause full-board reads.
      if (event.type === 'TokenReceived') return
      clearTimeout(timer); timer = setTimeout(() => void reload(), 400)
    })
    return () => { invalidate(); clearTimeout(timer); void stop.then(off => off()).catch(() => {}) }
  }, [folderKey, reload, invalidate])
  return { data, reload }
}
