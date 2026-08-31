// Dev-only capture affordance.
//
// This session (and CI) can capture an app window but cannot deliver synthetic
// clicks to WebView2, so the screenshots in test-results/ai-workspace are taken
// by choosing which screen loads and restarting the app, rather than by driving
// the UI. `scripts/capture-aiw.ps1` rewrites this file between shots.
//
// All values empty means "behave normally", which is how it ships: the three
// reads below are inert, so this costs nothing at runtime.
//
//   CAPTURE_RAIL     rail view to open      ('' = remembered / Home)
//   CAPTURE_PAGE     AI Workspace page      ('' = Overview)
//   CAPTURE_PROJECT  project id to select   ('' = first)
//   CAPTURE_FEATURE  feature slug to select ('' = none)
//   CAPTURE_AUTORUN  run the mock demo on load
//   CAPTURE_BOT      node id whose bot page to open ('' = none)
//   CAPTURE_BOT_TAB  which of its tabs to show ('' = Overview)
//   CAPTURE_BOT_MODAL  'interview' | 'create' ('' = none)

export const CAPTURE_RAIL: string = ''
export const CAPTURE_PAGE = ''
export const CAPTURE_PROJECT = ''
export const CAPTURE_FEATURE = ''
export const CAPTURE_AUTORUN = false
export const CAPTURE_BOT: string = ''
export const CAPTURE_BOT_TAB: string = ''
export const CAPTURE_BOT_MODAL: string = ''
