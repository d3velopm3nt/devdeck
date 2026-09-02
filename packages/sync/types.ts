// Server-authoritative outcome, per ADR.
export type SyncResult = {
  outcome: 'applied' | 'rejected' | 'deferred'
}
