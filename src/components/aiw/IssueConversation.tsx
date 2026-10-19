import { useEffect, useState, type ReactNode } from 'react'
import { type ChatMessage } from '../../lib/aiw'
import * as ipc from '../../lib/ipc'
import { useApp } from '../../store'
import { openChatRun, useChatWorkspace } from '../../lib/chatWorkspace'
import { assembleWork, workDisplayState } from '../../lib/workHub'
import { useWorkData } from '../work/useWorkData'
import { StateBadge } from '../ui/DesignSystem'

export function IssueConversation({ id, workItem, messages, renderMessage }: {
  id: string; workItem: string; messages: ChatMessage[]; renderMessage: (message: ChatMessage, key: string) => ReactNode
}) {
  const nodes = useApp(s => s.nodes)
  const { data, reload } = useWorkData(nodes)
  const [reports, setReports] = useState<ipc.ManagerMessage[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout>
    setReports([]); setError('')
    const refresh = async () => {
      try {
        const entries = await ipc.messageBoard()
        if (live) { setReports(entries.filter(entry => entry.task_id === workItem && entry.source !== 'conversation')); setError('') }
        if (live) await reload()
      } catch { if (live) setError('Agent activity could not refresh. Displayed information may be out of date.') }
      finally { if (live) timer = setTimeout(refresh, 5000) }
    }
    void refresh()
    return () => { live = false; clearTimeout(timer) }
  }, [workItem, reload])
  const card = assembleWork(data.records, data.legacy, data.monitor, data.workflows, data.claims).find(c => c.record.id === workItem)
  const openProgress = () => useChatWorkspace.setState(s => ({ split:true, tab:'workflow', tabs:s.tabs.includes('workflow') ? s.tabs : [...s.tabs,'workflow'] }))
  const steps = card?.workflows.flatMap(w => w.view.definition.steps) ?? []
  const blocked = steps.filter(s => s.status === 'blocked')
  const timeline = [
    ...messages.map((message, i) => ({ key:`chat-${i}`, at:message.tool === 'work.source' ? '' : message.at, message, report:undefined as ipc.ManagerMessage | undefined })),
    ...reports.map(report => ({ key:report.id, at:report.created_at, message:undefined as ChatMessage | undefined, report })),
  ].sort((a,b) => a.at.localeCompare(b.at) || a.key.localeCompare(b.key))
  return <div className="mx-auto max-w-3xl">
    <section aria-label="Issue status" className="sticky top-0 z-10 mb-5 rounded-lg border border-line bg-panel p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2"><h2 className="min-w-0 basis-full text-sm font-semibold">{card?.record.title || 'Linked work item'}</h2>{card && <StateBadge state={workDisplayState(card)}/>}<button className="btn-ghost text-xs" onClick={openProgress}>Open progress</button></div>
      {!card && <p className="mt-2 text-xs text-muted">{data.loading ? 'Loading work status…' : 'Linked work item is unavailable.'}</p>}
      {blocked.map(step => <div key={step.id} className="mt-2 text-xs text-err"><strong>{step.title}</strong><p className="mt-1">{(step.evidence || 'Needs attention. Open progress for details.').slice(0,140)}{step.evidence.length > 140 ? '…' : ''}</p>{step.evidence.length > 140 && <details className="mt-1"><summary className="cursor-pointer">Full blocker reason</summary><p className="mt-2 whitespace-pre-wrap break-words">{step.evidence}</p></details>}</div>)}
      {(error || data.errors.length > 0) && <p role="alert" className="mt-2 text-xs text-err">{error || 'Work status could not fully refresh.'}</p>}
    </section>
    <section aria-label="Issue conversation activity">
      {timeline.map(entry => entry.message ? renderMessage(entry.message, entry.key) : entry.report && <article key={entry.key} className="my-4 border-l-2 border-line pl-4">
        <div className="flex flex-wrap items-center gap-2 text-xs"><strong>{entry.report.agent_name || entry.report.from}</strong><span className="text-muted">Recorded {entry.report.source === 'workflow' ? 'run' : 'message'}</span><StateBadge state={entry.report.activity_status || (entry.report.outcome === 'failed' ? 'failed' : 'neutral')}/><time className="ml-auto text-muted">{new Date(entry.at).toLocaleString()}</time></div>
        <p className="mt-2 text-sm font-medium">{entry.report.subject}</p>
        <details className="mt-2 text-xs text-dim"><summary className="cursor-pointer">Read report</summary><p className="mt-2 whitespace-pre-wrap break-words">{entry.report.body}</p></details>
        {entry.report.run_id && <button className="btn-ghost mt-2 text-xs" onClick={() => openChatRun(id,entry.report!.run_id!,entry.report!.subject)}>Open run details</button>}
      </article>)}
    </section>
  </div>
}
