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
 *  uses â€” the only way to photograph an unread row without a mouse. */
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
/** On the learn step, press through to a phase without a mouse:
 *  approve | reading | done. Reading starts the run on whatever provider the
 *  assistant is on, so this is only ever set on a throwaway profile with the
 *  mock. Empty in every shipped build. */
export const CAPTURE_LEARN_AUTO: string = ''
/** Open Your life on mount. Empty in every shipped build. */
export const CAPTURE_LIFE_PAGE: boolean = false
/** On the home step, fill in sample answers and make the space, without a
 *  mouse. Only on a throwaway profile. Empty in every shipped build. */
export const CAPTURE_HOME_AUTO: boolean = false
/** Which tab a node page opens on: known | files | ... Empty in every shipped build. */
export const CAPTURE_NODE_TAB: string = ''
/** Open adding a business: `new`, a node id, or `id:step`. Empty in every shipped build. */
export const CAPTURE_BUSINESS: string = ''
/** Open the screen that clears old business workspaces. Empty in every shipped build. */
export const CAPTURE_CLEAR: boolean = false
/** On a business step, press through without a mouse: read | browser | pick | link | learn | make.
 *  Only ever set on a throwaway profile. Empty in every shipped build. */
export const CAPTURE_BUSINESS_AUTO: string = ''
/** On the clearing screen, press the red button. Only on a throwaway profile. Empty in every shipped build. */
export const CAPTURE_CLEAR_AUTO: boolean = false
/** Screenshot harness: open the start-a-worker card, as `handle|node|title|intent`. */
export const CAPTURE_START_WORKER: string = ''
/** Screenshot harness: actually start one, same shape. Spends money: throwaway profiles only. */
export const CAPTURE_GO: string = ''
/** Screenshot harness: open the library's Add from GitHub on a repository. */
export const CAPTURE_LIBRARY: string = ''
/** Screenshot harness: open one run as a document, by id. */
export const CAPTURE_RUN: string = ''
/** Screenshot harness: open one worker's editor, by handle. */
export const CAPTURE_WORKER: string = ''
