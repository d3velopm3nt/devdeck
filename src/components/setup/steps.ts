// The setup steps, in order, and where you got to.
//
// Two settings, both plain words: `setup.at` is the step you were on when
// you last left, so Today's "finish setting up" opens there; `setup.reached`
// is the furthest step you have completed, so the step bar lets you go back
// to any of them and never forward past what you have done. Each step
// populates itself from what it already saved, so going back shows what was
// processed and chosen rather than a blank form.

export type SetupStep = 'voice' | 'mail' | 'learn' | 'life' | 'home'

export const SETUP_ORDER: SetupStep[] = ['voice', 'mail', 'learn', 'life', 'home']

export const SETUP_AT = 'setup.at'
export const SETUP_REACHED = 'setup.reached'

export const stepIndex = (s: SetupStep | 'done' | null | undefined): number =>
  s === 'done' ? SETUP_ORDER.length : s ? SETUP_ORDER.indexOf(s) : -1

export const isStep = (s: string | null | undefined): s is SetupStep =>
  !!s && (SETUP_ORDER as string[]).includes(s)

/** What the step bar needs to be clickable. */
export interface SetupNav {
  reached: SetupStep | 'done'
  onGo: (s: SetupStep) => void
}
