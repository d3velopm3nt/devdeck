// The system log stream ids, mirroring the block in `src-tauri/src/services.rs`.
//
// Log entries are filtered by id rather than by display name, because names
// are not unique: a service you called "mail" and the mail system stream are
// two different sources that would otherwise read as one. The Rust side is the
// source of truth and has a test asserting the ids stay distinct — change them
// there first, then here.

export const INSTALL_LOG_ID = -100_000
export const UPDATE_LOG_ID = -200_000
export const SETUP_LOG_ID = -300_000
export const GIT_LOG_ID = -400_000
export const AI_LOG_ID = -500_000
export const RUNNER_LOG_ID = -600_000
export const STASH_LOG_ID = -700_000
export const MAIL_LOG_ID = -800_000

/** The lowest id a system stream uses; everything above it is a service or a
 *  background run. Managed services use their database row (counting up from
 *  1) and ephemeral runs count down from -1. */
export const SYSTEM_LOG_FLOOR = INSTALL_LOG_ID

/** What kind of thing a log id belongs to, for telling apart two sources that
 *  share a display name. */
export const logKind = (id: number): 'system' | 'run' | 'service' =>
  id <= SYSTEM_LOG_FLOOR ? 'system' : id < 0 ? 'run' : 'service'
