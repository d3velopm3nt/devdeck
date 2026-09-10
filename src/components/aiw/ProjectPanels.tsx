// The Assistant's project-scoped pages, as dock documents.
//
// Before this, clicking "Agents" swapped the entire surface out while clicking
// "Services" opened a document — two identical-looking controls doing
// categorically different things. Now everything a project offers opens the
// same way: a tab, in one place, that you can split and drag like a terminal.
//
// **A known limit, stated rather than hidden.** The Assistant keeps one
// selected project, so a panel points the store at its own project when it
// becomes active. Open two of these for different projects side by side in a
// split and both will show the active one's data. Making them genuinely
// independent means threading a project through every page instead of reading
// it from the store — worth doing, not worth blocking this on.

import { useEffect } from 'react'
import type { IDockviewPanelProps } from 'dockview'
import { useAiw } from '../../lib/aiwStore'
import { Chat } from './Chat'
import { ContextInspector, Features, Git } from './AiWorkspace'

type Params = { projectId: string }

/// Point the store at this panel's project while it is on screen.
///
/// On mount *and* on every activation: a panel that only claimed the project
/// once would quietly render another project's data the second time you
/// clicked its tab.
function useProjectPanel(props: IDockviewPanelProps<Params>) {
  const projectId = props.params.projectId
  const selectProject = useAiw((s) => s.selectProject)
  const current = useAiw((s) => s.projectId)

  useEffect(() => {
    if (current !== projectId) void selectProject(projectId)
    const sub = props.api.onDidActiveChange((e) => {
      if (e.isActive && useAiw.getState().projectId !== projectId) {
        void useAiw.getState().selectProject(projectId)
      }
    })
    return () => sub.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])
}

export function AssistantPanel(props: IDockviewPanelProps<Params>) {
  useProjectPanel(props)
  return <Chat />
}

export function ContextPanel(props: IDockviewPanelProps<Params>) {
  useProjectPanel(props)
  return <ContextInspector />
}

export function GitPanel(props: IDockviewPanelProps<Params>) {
  useProjectPanel(props)
  return <Git />
}

export function FeaturesPanel(props: IDockviewPanelProps<Params>) {
  useProjectPanel(props)
  return <Features />
}
