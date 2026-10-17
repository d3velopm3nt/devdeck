import { Icon, type IconName } from '../lib/icons'
export const noticeIdentity: Record<string, { icon: IconName; label: string; action: string }> = {
  info: { icon: 'info', label: 'Information', action: 'View details' },
  approval: { icon: 'ok', label: 'Needs review', action: 'Review' },
  alert: { icon: 'alert', label: 'Needs attention', action: 'Investigate' },
  blocker: { icon: 'pause', label: 'Blocked', action: 'Open details' },
}
export function NoticeIdentity({ kind, size = 18 }: { kind: string; size?: number }) {
  const identity=noticeIdentity[kind] || noticeIdentity.info
  return <span className={'notice-identity notice-'+kind} title={identity.label}><Icon name={identity.icon} size={size} /></span>
}
