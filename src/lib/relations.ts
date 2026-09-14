// What a relation word means for grouping.
//
// A role is stored as the word you used, "wife" or "stepson", because that
// is what you would say. The pages group by what the word means, so a wife
// is family and a stepson is a child without either being rewritten.

export type RelationGroup = 'partner' | 'child' | 'parent' | 'sibling' | 'friend' | 'pet' | 'other'

const WORDS: Record<RelationGroup, string[]> = {
  partner: ['partner', 'wife', 'husband', 'spouse', 'fiancé', 'fiancée', 'fiance', 'fiancee', 'girlfriend', 'boyfriend'],
  child: ['child', 'son', 'daughter', 'stepson', 'stepdaughter', 'stepchild', 'kid', 'baby'],
  parent: ['parent', 'father', 'mother', 'dad', 'mom', 'mum', 'stepfather', 'stepmother', 'father-in-law', 'mother-in-law'],
  sibling: ['sibling', 'brother', 'sister', 'stepbrother', 'stepsister', 'brother-in-law', 'sister-in-law'],
  friend: ['friend', 'best friend', 'mate', 'neighbour', 'neighbor'],
  pet: ['pet', 'dog', 'cat', 'puppy', 'kitten', 'horse', 'pony', 'bird', 'parrot', 'rabbit', 'hamster', 'fish', 'goldfish'],
  other: [],
}

export function relationGroup(role: string, kind = 'person'): RelationGroup {
  if (kind === 'pet') return 'pet'
  const r = role.trim().toLowerCase()
  if (!r) return 'other'
  for (const [group, words] of Object.entries(WORDS) as Array<[RelationGroup, string[]]>) {
    if (words.some((w) => r === w || r.startsWith(`${w} `) || r.endsWith(` ${w}`))) return group
  }
  return 'other'
}

/** Family in the wide sense: partner, children, parents, siblings. */
export const isFamily = (role: string) =>
  ['partner', 'child', 'parent', 'sibling'].includes(relationGroup(role))

/** Who usually lives with you, as a first guess. */
export const livesWith = (role: string): boolean => {
  const g = relationGroup(role)
  return g === 'partner' || g === 'child' || g === 'pet'
}
