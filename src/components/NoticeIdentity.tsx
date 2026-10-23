import { StateIcon } from './ui/DesignSystem'
import { type IconName } from '../lib/icons'
export const noticeIdentity: Record<string, { icon: IconName; label: string; action: string }> = {
  info: { icon: 'info', label: 'Information', action: 'View details' },
  approval: { icon: 'view', label: 'Needs review', action: 'Review' },
  alert: { icon: 'alert', label: 'Needs attention', action: 'Investigate' },
  blocker: { icon: 'conflict', label: 'Blocked', action: 'Open details' },
}
export function NoticeIdentity({ kind, size = 18 }: { kind: string; size?: number }) {
  const identity=noticeIdentity[kind] || noticeIdentity.info
  return <StateIcon state={kind==='approval'?'review':kind==='blocker'?'blocked':kind==='alert'?'failed':'information'} label={identity.label} size={size}/>
}
