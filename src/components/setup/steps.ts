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

/** What the step bar needs to be clickable. Any flow: personal setup or a business. */
export interface SetupNav {
  reached: string
  onGo(s: string): void
}

/** One step in a step bar. */
export interface StepDef {
  id: string
  label: string
}

export const PERSONAL_STEPS: StepDef[] = [
  { id: 'voice', label: 'Voice' },
  { id: 'mail', label: 'Mail' },
  { id: 'learn', label: 'Learn' },
  { id: 'life', label: 'Life' },
  { id: 'home', label: 'Home' },
]

export type BusinessStepId = 'business' | 'sells' | 'code' | 'mail' | 'learn' | 'team'

/** Adding a business. Each step can be gone back to once reached. */
export const BUSINESS_STEPS: StepDef[] = [
  { id: 'business', label: 'Business' },
  { id: 'sells', label: 'What it sells' },
  { id: 'code', label: 'Code' },
  { id: 'mail', label: 'Mail' },
  { id: 'learn', label: 'Learn' },
  { id: 'team', label: 'Team' },
]
