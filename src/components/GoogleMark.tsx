/**
 * Google's four-colour G.
 *
 * Inline rather than from the icon registry on purpose: `lucide-react` ships
 * no brand marks, which is already written down in CLAUDE.md as the reason
 * `Github` does not exist here either. It is also the one mark on this screen
 * that must not be recoloured — Google's brand terms require the logo as
 * given, so this deliberately ignores the theme tokens every other icon obeys.
 *
 * The paths are the official four-quadrant mark at a 48-unit viewBox.
 */
export function GoogleMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  )
}

/**
 * The button Google's brand terms describe: their mark, their wording, on a
 * neutral ground. Not restyled to match the app, because a sign-in button that
 * looks like the app's own buttons is the pattern phishing pages imitate.
 */
export function GoogleButton({
  onClick,
  disabled,
  label = 'Continue with Google',
}: {
  onClick: () => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-2.5 rounded-[6px] border border-[#dadce0] bg-white px-4 py-2.5 text-[13px] font-medium text-[#3c4043] transition-shadow hover:shadow-[0_1px_3px_rgba(60,64,67,0.3)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:shadow-none"
    >
      <GoogleMark size={17} />
      {label}
    </button>
  )
}
