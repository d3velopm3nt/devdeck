import { settingGet, settingSet } from './ipc'

export const GITHUB_REFRESH_EVENT = 'devdeck:github-refresh-settings'
const KEY = 'activity.github.refresh_minutes'
export const GITHUB_REFRESH_OPTIONS = [0, 1, 5, 15, 30, 60]
export async function loadGithubRefresh(): Promise<number> {
  const saved = await settingGet(KEY)
  const minutes = saved === null ? 1 : Number(saved)
  return GITHUB_REFRESH_OPTIONS.includes(minutes) ? minutes : 1
}
export async function saveGithubRefresh(minutes: number): Promise<void> {
  if (!GITHUB_REFRESH_OPTIONS.includes(minutes)) throw new Error('Choose a supported refresh interval.')
  await settingSet(KEY, String(minutes))
  window.dispatchEvent(new Event(GITHUB_REFRESH_EVENT))
}
