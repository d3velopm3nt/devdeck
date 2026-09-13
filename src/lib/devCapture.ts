export const CAPTURE_RAIL: string = ''
export const CAPTURE_PAGE = ''
export const CAPTURE_PROJECT = ''
export const CAPTURE_FEATURE = ''
export const CAPTURE_AUTORUN = false
export const CAPTURE_BOT: string = ''
export const CAPTURE_BOT_TAB: string = ''
export const CAPTURE_BOT_MODAL: string = ''
export const CAPTURE_SETTINGS_TAB: string = ''
export const CAPTURE_SAY: string[] = [
]

/** Community actions to run once on mount, in order:
 *  `install:<id>` | `grant:<id>:<agentId>` | `revoke:<id>:<agentId>` |
 *  `tab:browse` | `tab:installed` | `open:<catalogue id>`.
 *  This session cannot deliver clicks, so a screenshot of the install/grant
 *  split has to be produced some other way. It goes through the same commands
 *  the buttons call. Empty in every shipped build. */
export const CAPTURE_COMMUNITY: string[] = []
export const CAPTURE_TEAM_TAB: string = ''
export const CAPTURE_GOAL: string = ''
export const CAPTURE_NODE: string = ''
export const CAPTURE_EXPAND: string = ''
export const CAPTURE_WORKSPACE: string = ''
export const CAPTURE_BOTTOM: string = ''
export const CAPTURE_CHECK: string = ''
export const CAPTURE_CONTEXT: boolean = false
export const CAPTURE_BELL: boolean = false
/** Put the newest failure back to unread, through the same command a click
 *  uses — the only way to photograph an unread row without a mouse. */
export const CAPTURE_INBOX_UNREAD: boolean = false
export const CAPTURE_CAL_VIEW: string = ''
export const CAPTURE_EVENT: string = ''
export const CAPTURE_NEW_SCHEDULE: boolean = false
export const CAPTURE_EVENT_OPEN: string = ''
export const CAPTURE_ENTRY: string = ''
export const CAPTURE_FILE_ROOT: string = ''
/** Which project's file browser is open, as a node id. One at a time, so a
 *  screenshot of the browser has to say which. Empty in every shipped build. */
export const CAPTURE_BROWSE: string = ''
/** Open the whole-vault section, and these folder paths inside it. */
export const CAPTURE_VAULT: string = ''
/** Open the Add sheet on the active workspace. */
export const CAPTURE_ADD: boolean = false
/** Open the Git document for this node id on mount. */
export const CAPTURE_GIT: string = ''
export const CAPTURE_OPEN_FILE: string = ''

/** Skip the first run, for shots of anything behind it. */
export const CAPTURE_MET: boolean = false
/** Open the mail account editor on a new account of this kind: gmail | imap. */
export const CAPTURE_MAIL_ACCOUNT: string = ''
/** Open the first run on a given step: voice | mail | learn | life | home. */
export const CAPTURE_MEET_STEP: string = ''
/** Open the learn run on mount. This session cannot deliver clicks, so the
 *  only way to photograph the estimate is to open the panel the same way the
 *  link in Contacts does. Empty in every shipped build. */
export const CAPTURE_LEARN: boolean = false
/** Open Mail on this pane, once: mail | contacts. Once and not on every render,
 *  because the app may be in use while the shot is taken and a flag that
 *  re-applies itself locks whoever is using it out of every other view.
 *  Empty in every shipped build. */
export const CAPTURE_MAIL_PANE: string = ''
