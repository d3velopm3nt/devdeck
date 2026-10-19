/** Dev's identity; the Link mark remains the application logo. */
export function DevAvatar({ size = 32 }: { size?: number }) {
  return <img src="/avatars/dev-robot-v1.png" alt="" aria-hidden="true" width={size} height={size} style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0 }} />
}
