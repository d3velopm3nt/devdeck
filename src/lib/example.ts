// Loading the example workspace: seed it, refresh everything it touched, then
// drop the user straight into its space page so there's something to look at.

import * as ipc from './ipc'
import { useApp } from '../store'
import { openSpace } from './dock'

export async function loadExampleWorkspace(): Promise<void> {
  const projectId = await ipc.seedExample()
  const st = useApp.getState()
  await Promise.all([
    st.refreshTree(),
    st.refreshServices(),
    st.refreshCommands(),
    st.refreshProfiles(),
  ])
  const app = useApp.getState()
  app.setSelectedNode(projectId)
  const name = app.nodes.find((n) => n.id === projectId)?.name ?? 'Demo App'
  openSpace(projectId, name)
}
