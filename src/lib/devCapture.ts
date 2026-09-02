// Dev-only capture affordance.
//
// This session (and CI) can capture an app window but cannot deliver synthetic
// clicks to WebView2, so the screenshots in test-results are taken by choosing
// which screen loads and restarting the app, rather than by driving the UI.
// `scripts/capture-team.ps1` rewrites this file between shots.
//
// All values empty means "behave normally", which is how it ships: every read
// below is inert, so this costs nothing at runtime.
//
//   CAPTURE_RAIL       rail view to open      ('' = remembered / Home)
//   CAPTURE_PAGE       AI Workspace page      ('' = Overview)
//   CAPTURE_PROJECT    project id to select   ('' = first)
//   CAPTURE_FEATURE    feature slug to select ('' = none)
//   CAPTURE_AUTORUN    run the mock demo on load
//   CAPTURE_BOT        node id whose bot to open ('' = none)
//   CAPTURE_BOT_TAB    which of its tabs to show ('' = Chat)
//   CAPTURE_BOT_MODAL  'interview' | 'create' ('' = none)
//   CAPTURE_SETTINGS_TAB  which Settings tab ('' = General)
//   CAPTURE_SAY        messages to send once on load, for capturing evidence:
//                      'feature:<node>:<slug>:text' | 'node:<node>:text' |
//                      'bot:<node>:text'. Real IPC, real replies — this only
//                      chooses what gets said, never what comes back.
//   CAPTURE_TEAM_TAB   which Team tab is open ('' = Goals)
//   CAPTURE_GOAL       "<nodeId>:<feature>" to open on Goals ('' = the first)
//   CAPTURE_NODE       node id whose thread to open ('' = none)
//   CAPTURE_EXPAND     node ids to open in the tree, comma-separated
//   CAPTURE_WORKSPACE  workspace tab to open ('' = the remembered one)

export const CAPTURE_RAIL: string = ''
export const CAPTURE_PAGE = ''
export const CAPTURE_PROJECT = ''
export const CAPTURE_FEATURE = ''
export const CAPTURE_AUTORUN = false
export const CAPTURE_BOT: string = ''
export const CAPTURE_BOT_TAB: string = ''
export const CAPTURE_BOT_MODAL: string = ''
export const CAPTURE_SETTINGS_TAB: string = ''
export const CAPTURE_SAY: string[] = []
export const CAPTURE_TEAM_TAB: string = ''
export const CAPTURE_GOAL: string = ''
export const CAPTURE_NODE: string = ''
export const CAPTURE_EXPAND: string = ''
export const CAPTURE_WORKSPACE: string = ''
