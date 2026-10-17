/** Link: the approved interlocking DevDeck mark. */
export function DeckLogo({ size = 34 }: { size?: number }) {
  return <svg className="deck-logo" width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <path d="M23 6H12a6 6 0 0 0-6 6v9a6 6 0 0 0 6 6h12v-7H13v-7h10Z" fill="currentColor" />
    <path d="M17 34h11a6 6 0 0 0 6-6v-9a6 6 0 0 0-6-6H16v7h11v7H17Z" fill="var(--c-accent, #9890ef)" />
  </svg>
}
