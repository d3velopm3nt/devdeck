// Which files a node actually has, cached.
//
// Behind the clickable paths in a thread: a span shaped like a path only
// becomes a link once we have seen the file, and seeing it is a directory
// listing rather than a read. One `node_files` call per folder, kept for the
// session, so a message naming six files under `src/` costs one call — and
// reading six files to find out they exist would be a strange way to ask.

import * as ipc from './ipc'

const listings = new Map<string, Promise<Set<string>>>()

/** The names in one folder of a node's work tree. */
export function filesIn(nodeId: number, dir: string): Promise<Set<string>> {
  const key = `${nodeId}:${dir}`
  const hit = listings.get(key)
  if (hit) return hit
  const p = ipc
    .nodeFiles(nodeId, dir, 'work')
    .then((rows) => new Set(rows.map((r) => r.name)))
    // A folder we could not read is an empty answer, not a retry loop: the
    // span stays plain text, which is what it was before we asked.
    .catch(() => new Set<string>())
  listings.set(key, p)
  return p
}

/// Forget what we listed. Called after anything that changes files on disk,
/// so a file created since a message was written becomes clickable.
export function forgetFileListings() {
  listings.clear()
}
