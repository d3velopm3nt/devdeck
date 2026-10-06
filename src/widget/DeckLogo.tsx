import { useId } from 'react'

/** The rounded, split D from the approved Deck widget reference. */
export function DeckLogo() {
  const id = useId()
  return (
    <svg
      className="deck-logo"
      width="34"
      height="34"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={id}
          x1="8"
          y1="4"
          x2="30"
          y2="37"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#72b9ff" />
          <stop offset=".48" stopColor="#6760ff" />
          <stop offset="1" stopColor="#6430e8" />
        </linearGradient>
      </defs>
      <path
        d="M9 5h11c11 0 17 6 17 15S31 35 20 35H9a4 4 0 0 1-4-4V19a4 4 0 0 1 8 0v8h7c6 0 9-2 9-7s-3-7-9-7H9a4 4 0 0 1 0-8Z"
        fill={`url(#${id})`}
      />
    </svg>
  )
}
