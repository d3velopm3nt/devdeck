// Signed self-update via Tauri's updater plugin. Used for installs scoop
// doesn't manage. Returns 'updated' after applying (the app relaunches),
// 'none' when no signed update is published yet, or throws on a real failure —
// callers fall back to the download-the-installer path in those cases.

import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

export async function tauriSelfUpdate(onStatus: (s: string) => void): Promise<'updated' | 'none'> {
  const update = await check()
  if (!update) return 'none'

  onStatus(`Downloading v${update.version}…`)
  let total = 0
  let got = 0
  await update.downloadAndInstall((e) => {
    switch (e.event) {
      case 'Started':
        total = e.data.contentLength ?? 0
        onStatus('Downloading…')
        break
      case 'Progress':
        got += e.data.chunkLength
        onStatus(total ? `Downloading ${Math.round((got / total) * 100)}%` : 'Downloading…')
        break
      case 'Finished':
        onStatus('Installing…')
        break
    }
  })

  onStatus('Installed — restarting…')
  await relaunch()
  return 'updated'
}
