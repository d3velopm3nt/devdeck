// Read and unread, decided in one place.
//
// The Inbox draws three streams — approvals, disagreements, failures — and the
// rail badge and the top bar's bell count the same rows from outside the page.
// Three implementations of "has this been read" is three chances for the badge
// to say two while the page shows one.
//
// A row is unread until somebody says otherwise. The floor is the exception
// and exists only for history: before per-row state there was a single
// "everything up to here has been seen" timestamp, and without it an upgrade
// would announce a month of old failures as new.

import type { Activity } from './types'

/// The id a row is known by, everywhere. It has to be stable across reloads,
/// which is why it is built from the source's own id rather than the position
/// in a list.
export const activityItem = (id: number) => `activity:${id}`
export const approvalItem = (id: string) => `approval:${id}`
export const conflictItem = (id: string) => `conflict:${id}`

export interface ReadState {
  /// item id → read. Absent means nobody has said.
  read: Record<string, boolean>
  /// Anything older than this counts as read unless it says otherwise.
  floor: number
  /// Whether the state above has actually been read from the database yet.
  ///
  /// It matters because the failure is silent and the wrong way round: a read
  /// that never came back leaves an empty map and a floor of zero, which says
  /// *everything is unread* — six red rows and a badge, from a fetch that
  /// failed. Until it lands, nothing is unread; a false alarm on every slow
  /// start is worse than a badge that appears a moment late.
  loaded: boolean
}

/// Whether a row still wants looking at.
///
/// `at` is when the thing happened. A live approval has no meaningful moment
/// before now, so it passes `Date.now()` and is unread until acted on — which
/// is right: nothing that is blocking an agent should go quiet on its own.
export function unread(item: string, at: number, s: ReadState): boolean {
  if (!s.loaded) return false
  const said = s.read[item]
  if (said !== undefined) return !said
  return at > s.floor
}

/// The failures a person has not looked at yet.
export const unreadFailures = (activity: Activity[], s: ReadState): Activity[] =>
  activity.filter((a) => !a.ok && unread(activityItem(a.id), a.ts, s))
