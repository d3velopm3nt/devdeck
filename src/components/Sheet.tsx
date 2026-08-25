// The slide-over editor sheet. Command/service/profile editors open here
// (over whatever view you're in) instead of as main-area tabs — you keep
// your context, Esc closes, no tab residue.

import { useEffect } from 'react'
import { useApp } from '../store'
import { CommandEditorPage } from './editors/CommandEditorPage'
import { ServiceEditorPage } from './editors/ServiceEditorPage'
import { ProfileEditorPage } from './editors/ProfileEditorPage'

export function Sheet() {
  const { sheet, closeSheet } = useApp()

  useEffect(() => {
    if (!sheet) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSheet()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheet, closeSheet])

  if (!sheet) return null

  const props = {
    params: { id: sheet.id, projectId: sheet.projectId },
    api: { close: closeSheet },
  }

  return (
    <>
      <div className="sheet-scrim" onClick={closeSheet} />
      <div className="sheet-panel flex flex-col" role="dialog" aria-modal="true">
        {sheet.kind === 'command' && <CommandEditorPage key={`c-${sheet.id}`} {...props} />}
        {sheet.kind === 'service' && <ServiceEditorPage key={`s-${sheet.id}`} {...props} />}
        {sheet.kind === 'profile' && <ProfileEditorPage key={`p-${sheet.id}`} {...props} />}
      </div>
    </>
  )
}
