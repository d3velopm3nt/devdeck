// Command Widget — a faithful port of the Claude Design "Command Widget"
// (Command Widget.dc.html), driven by DevDeck's real backend instead of
// mock data. Exact styles/SVGs from the design are preserved verbatim
// (inline-style strings parsed by css()); its data model (workspaces →
// spaces → folders → items, statuses, recents, usage) is built from
// DevDeck's nodes/commands/services/svcStates/recents, and its actions
// call real Tauri commands. Collapse/expand and drag/resize drive the
// real OS window.

import { useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window'
import { LogicalPosition } from '@tauri-apps/api/dpi'
import * as ipc from '../lib/ipc'
import { useApp } from '../store'
import type { SvcState, TreeNode } from '../lib/types'
import { findNode, resolveDir } from '../lib/tree'
import { widgetOpenTerminal, widgetRunCommand, serviceDir } from './widgetActions'

// Parse a design inline-style string ("a:b;c:d") into a React style object,
// so the exact style strings from the design can be used verbatim.
function css(s: string): React.CSSProperties {
  const o: Record<string, string> = {}
  for (const decl of s.split(';')) {
    const i = decl.indexOf(':')
    if (i < 0) continue
    const k = decl.slice(0, i).trim()
    if (!k) continue
    o[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = decl.slice(i + 1).trim()
  }
  return o as React.CSSProperties
}

const PALETTE = ['#7C8CF8', '#4ADE80', '#FBBF24', '#F472B6', '#38BDF8', '#A78BFA', '#FB7185']
const win = () => getCurrentWindow()

// Floating-window states and screen-corner docking.
type Corner = 'tl' | 'tr' | 'bl' | 'br' | 'free'
type Mode = 'icon' | 'quick' | 'full'
const CORNER_MARGIN = 14
const CORNER_BOTTOM = 52 // clears the Windows taskbar for bottom corners
const CORNERS: { key: Corner; label: string }[] = [
  { key: 'tl', label: '◤' },
  { key: 'tr', label: '◥' },
  { key: 'bl', label: '◣' },
  { key: 'br', label: '◢' },
  { key: 'free', label: '✛' },
]

type CollapsedStyle = 'single' | 'strip'
const STRIP_W = 60
const STRIP_ICON = 44
const STRIP_GAP = 8

function sizeForMode(
  mode: Mode,
  orient: 'v' | 'h',
  full: { w: number; h: number },
  collapsed?: { style: CollapsedStyle; count: number },
): { w: number; h: number } {
  if (mode === 'icon') {
    if (collapsed?.style === 'strip') {
      // toggle + sessions + divider + open-full, all stacked vertically
      const n = collapsed.count
      const h = 8 + 24 + STRIP_GAP + n * (STRIP_ICON + STRIP_GAP) + 10 + STRIP_ICON + 8
      return { w: STRIP_W, h: Math.min(Math.max(h, 118), 920) }
    }
    return { w: 58, h: 58 }
  }
  if (mode === 'quick') return orient === 'h' ? { w: 470, h: 150 } : { w: 296, h: 392 }
  return full
}

/// Move the widget window flush to a screen corner (with a margin), or do
/// nothing when free. Uses the current monitor so it works multi-display.
async function positionForCorner(corner: Corner, w: number, h: number) {
  if (corner === 'free') return
  try {
    const mon = await currentMonitor()
    if (!mon) return
    const sf = mon.scaleFactor
    const mx = mon.position.x / sf
    const my = mon.position.y / sf
    const mw = mon.size.width / sf
    const mh = mon.size.height / sf
    const left = corner === 'tl' || corner === 'bl'
    const top = corner === 'tl' || corner === 'tr'
    const x = left ? mx + CORNER_MARGIN : mx + mw - w - CORNER_MARGIN
    const y = top ? my + CORNER_MARGIN : my + mh - h - CORNER_BOTTOM
    await win().setPosition(new LogicalPosition(Math.round(x), Math.round(y)))
  } catch {
    /* ignore */
  }
}

// Hex "#rrggbb" → rgba() at the given alpha.
function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

function tint(t: string): [string, string] {
  if (/vite|next|proxy|metro|emulator|preview|wrangler|triton|kafka|node|npm|pnpm|yarn|dev/i.test(t)) return ['#7C8CF8', 'rgba(124,140,248,0.16)']
  if (/go|api|mock|worker|server|rust|cargo/i.test(t)) return ['#4ADE80', 'rgba(74,222,128,0.16)']
  if (/grafana|metrics|airflow|storybook|docs|tensorboard|py|python/i.test(t)) return ['#FBBF24', 'rgba(251,191,36,0.16)']
  return ['#9BA3B2', 'rgba(255,255,255,0.06)']
}

type Kind = 'command' | 'service'
type View = 'recent' | 'active' | 'browse' | 'search'
type Density = 'ultra' | 'compact' | 'comfortable'

interface Item {
  id: string
  refId: number
  kind: Kind
  name: string
  type: string
  spaceId: number
  wsId: number
  folderName: string
  projectName: string
  iconColor: string
  iconBg: string
  ownerId: number | null
}

const DENSITY: Record<Density, { padY: number; padX: number; rowMinH: number; name: number; meta: number; icon: number; rad: number }> = {
  ultra: { padY: 4, padX: 9, rowMinH: 32, name: 12.5, meta: 10.5, icon: 20, rad: 6 },
  compact: { padY: 7, padX: 11, rowMinH: 40, name: 13.5, meta: 11, icon: 24, rad: 7 },
  comfortable: { padY: 10, padX: 12, rowMinH: 50, name: 14.5, meta: 12, icon: 28, rad: 8 },
}

function statusMeta(st: string): [string, string] {
  const m: Record<string, [string, string]> = {
    running: ['#4ADE80', 'cw-pulse 2s ease-in-out infinite'],
    stopped: ['#6B7280', 'none'],
    restarting: ['#FBBF24', 'cw-pulse .8s ease-in-out infinite'],
    error: ['#F87171', 'none'],
  }
  return m[st] || m.stopped
}
function toggleVisual(running: boolean) {
  return {
    toggleLabel: running ? 'Stop' : 'Start',
    toggleBg: running ? 'rgba(248,113,113,0.14)' : 'rgba(74,222,128,0.15)',
    toggleIconWrap: running
      ? 'width:9px;height:9px;border-radius:2px;background:#F87171;display:block'
      : 'width:0;height:0;border-top:5px solid transparent;border-bottom:5px solid transparent;border-left:8px solid #4ADE80;display:block;margin-left:1px',
  }
}

// Map a DevDeck SvcState status to the design's status vocabulary.
function svcStatus(st?: SvcState): string {
  if (!st) return 'stopped'
  if (st.status === 'running') return 'running'
  if (st.status === 'crashed') return 'error'
  return 'stopped'
}

const Icon = {
  chev: (rot: string) => (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7d8494" strokeWidth="2.4" style={{ flexShrink: 0, transition: 'transform .12s', transform: rot }}><path d="M9 6l6 6-6 6" /></svg>
  ),
  play: (fill = '#8E9CFF', s = 13) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={fill}><path d="M7 5l12 7-12 7z" /></svg>
  ),
  restart: (s = 13) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#9BA3B2" strokeWidth="2.2"><path d="M21 12a9 9 0 11-2.6-6.4" /><path d="M21 3v5h-5" /></svg>
  ),
  term: (s = 13) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#9BA3B2" strokeWidth="2.2"><path d="M5 7l4 4-4 4M12 15h6" /></svg>
  ),
}

export function CommandWidget() {
  const app = useApp()

  // ---- interactive UI state (mirrors the design's this.state) ----
  const [view, setView] = useState<View>('recent')
  const [mode, setMode] = useState<Mode>('full')
  const [corner, setCorner] = useState<Corner>('free')
  const [quickOrient, setQuickOrient] = useState<'v' | 'h'>('v')
  const [collapsedStyle, setCollapsedStyle] = useState<CollapsedStyle>('single')
  const [widgetSetOpen, setWidgetSetOpen] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false)
  const [shortcutOpen, setShortcutOpen] = useState(false)
  const [currentWorkspace, setCurrentWorkspace] = useState<number | null>(null)
  const [currentSpace, setCurrentSpace] = useState<number | null>(null)
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'commands' | 'services' | 'projects' | 'spaces'>('all')
  const [selIndex, setSelIndex] = useState(0)
  const [density, setDensity] = useState<Density>('compact')
  const [recentCount, setRecentCount] = useState(3)
  const [toast, setToast] = useState<{ msg: string; color: string } | null>(null)
  const [expandedSize, setExpandedSize] = useState<{ w: number; h: number }>({ w: 380, h: 560 })
  const searchRef = useRef<HTMLInputElement>(null)
  const toastT = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const programmaticMove = useRef(false)

  const d = DENSITY[density]

  const showToast = (msg: string, color = '#7C8CF8') => {
    clearTimeout(toastT.current)
    setToast({ msg, color })
    toastT.current = setTimeout(() => setToast(null), 2400)
  }

  // ---- bootstrap + live events ----
  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    const root = document.getElementById('root')
    if (root) root.style.background = 'transparent'
    void app.bootstrap()
    const subs = [
      ipc.onSvcStatus((e) => useApp.getState().updateSvcState(e)),
      ipc.onStats((e) => useApp.getState().setStats(e)),
    ]
    void ipc.settingGet('widget_view').then((v) => v && setView(v as View))
    void ipc.settingGet('widget_density').then((v) => v && setDensity(v as Density))
    void ipc.settingGet('widget_recent_count').then((v) => v && setRecentCount(Number(v) || 3))
    // Corner-dock + quick-list orientation, then anchor if docked.
    void (async () => {
      const c = ((await ipc.settingGet('widget_corner')) as Corner | null) ?? 'free'
      const o = (await ipc.settingGet('widget_quick_orientation')) === 'h' ? 'h' : 'v'
      const cs: CollapsedStyle = (await ipc.settingGet('widget_collapsed_style')) === 'strip' ? 'strip' : 'single'
      setCorner(c)
      setQuickOrient(o)
      setCollapsedStyle(cs)
      const done = await ipc.settingGet('widget_tour_done')
      if (done !== '1') setTourOpen(true) // first run: guided tour in the full widget
      if (c !== 'free') await positionForCorner(c, sizeForMode('full', o, expandedSize).w, sizeForMode('full', o, expandedSize).h)
    })()
    return () => {
      for (const s of subs) void s.then((un) => un())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Snap to a screen corner when the user drags the widget near one.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const evaluateSnap = async () => {
      try {
        const mon = await currentMonitor()
        if (!mon) return
        const sf = mon.scaleFactor
        const pos = await win().outerPosition()
        const size = await win().outerSize()
        const x = pos.x / sf
        const y = pos.y / sf
        const w = size.width / sf
        const h = size.height / sf
        const mx = mon.position.x / sf
        const my = mon.position.y / sf
        const mw = mon.size.width / sf
        const mh = mon.size.height / sf
        const cs: [Corner, number, number][] = [
          ['tl', mx, my],
          ['tr', mx + mw - w, my],
          ['bl', mx, my + mh - h],
          ['br', mx + mw - w, my + mh - h],
        ]
        let best: Corner = 'free'
        let bestD = Infinity
        for (const [c, cx, cy] of cs) {
          const dist = Math.hypot(x - cx, y - cy)
          if (dist < bestD) {
            bestD = dist
            best = c
          }
        }
        const next: Corner = bestD < 72 ? best : 'free'
        if (next !== corner) {
          setCorner(next)
          void ipc.settingSet('widget_corner', next)
        }
        if (next !== 'free') {
          // Re-anchor using the window's actual current size.
          programmaticMove.current = true
          await positionForCorner(next, w, h)
          setTimeout(() => (programmaticMove.current = false), 220)
        }
      } catch {
        /* ignore */
      }
    }
    const unP = win().onMoved(() => {
      if (programmaticMove.current) return
      clearTimeout(t)
      t = setTimeout(() => void evaluateSnap(), 240)
    })
    return () => {
      clearTimeout(t)
      void unP.then((f) => f())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corner, mode, quickOrient, expandedSize])

  // Poll for data changes while the first-run tour is open (entities are
  // created in the main window, whose store is separate from the widget's).
  useEffect(() => {
    if (!tourOpen) return
    const tick = () => {
      const st = useApp.getState()
      void st.refreshTree()
      void st.refreshCommands()
      void st.refreshServices()
      void st.refreshProfiles()
    }
    const un = ipc.onDataChanged(tick)
    const iv = setInterval(tick, 1600)
    return () => {
      clearInterval(iv)
      void un.then((f) => f())
    }
  }, [tourOpen])

  useEffect(() => {
    const un = win().onFocusChanged(({ payload }) => {
      if (payload) {
        void useApp.getState().refreshRecents()
        void useApp.getState().refreshServices()
        void useApp.getState().refreshCommands()
        void useApp.getState().refreshTree()
      }
    })
    return () => void un.then((f) => f())
  }, [])

  // ---- build the design data model from DevDeck data ----
  const model = useMemo(() => {
    const nodes = app.nodes
    const workspaces = nodes.filter((n) => n.kind === 'workspace')
    const projects = nodes.filter((n) => n.kind === 'project')
    const wsOf = (n?: TreeNode): TreeNode | undefined => {
      let cur = n
      while (cur && cur.kind !== 'workspace') cur = nodes.find((x) => x.id === cur!.parent_id)
      return cur
    }
    const projOf = (n?: TreeNode): TreeNode | undefined => {
      let cur = n
      while (cur && cur.kind !== 'project') cur = nodes.find((x) => x.id === cur!.parent_id)
      return cur
    }
    const colorOf = (projectId: number) => PALETTE[Math.max(0, projects.findIndex((p) => p.id === projectId)) % PALETTE.length]

    const spaces = projects.map((p) => ({ id: p.id, wsId: wsOf(p)?.id ?? -1, name: p.name, color: colorOf(p.id) }))
    const spaceById = new Map(spaces.map((s) => [s.id, s]))
    const wsById = new Map(workspaces.map((w) => [w.id, w]))

    const itemsById = new Map<string, Item>()
    const build = (kind: Kind, refId: number, name: string, type: string, ownerId: number | null) => {
      const owner = ownerId != null ? findNode(nodes, ownerId) : undefined
      const project = projOf(owner ?? undefined)
      const ws = wsOf(owner ?? undefined)
      const folder = owner && owner.kind === 'folder' ? owner : undefined
      const [ic, ib] = kind === 'command' ? ['#9BA3B2', 'rgba(255,255,255,0.06)'] : tint(type + ' ' + name)
      const id = (kind === 'command' ? 'c' : 's') + refId
      itemsById.set(id, {
        id, refId, kind, name, type,
        spaceId: project?.id ?? -1,
        wsId: ws?.id ?? -1,
        folderName: folder?.name ?? '',
        projectName: project?.name ?? 'global',
        iconColor: ic, iconBg: ib, ownerId,
      })
    }
    app.commands.forEach((c) => build('command', c.id, c.name, 'Command', c.project_id))
    app.services.forEach((s) => build('service', s.id, s.name, 'Service', s.project_id))

    // statuses for service items (+ ephemeral background command runs)
    const statuses: Record<string, string> = {}
    itemsById.forEach((it) => {
      if (it.kind === 'service') statuses[it.id] = svcStatus(app.svcStates[it.refId])
    })

    return { workspaces, projects, spaces, spaceById, wsById, itemsById, wsOf, projOf }
  }, [app.nodes, app.commands, app.services, app.svcStates])

  // Default workspace/space once data is loaded.
  useEffect(() => {
    if (currentWorkspace == null && model.workspaces[0]) setCurrentWorkspace(model.workspaces[0].id)
    if (currentSpace == null && model.spaces[0]) {
      setCurrentSpace(model.spaces[0].id)
      setCurrentWorkspace(model.spaces[0].wsId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.workspaces.length, model.spaces.length])

  const curSpace = currentSpace != null ? model.spaceById.get(currentSpace) : undefined
  const curWs = currentWorkspace != null ? model.wsById.get(currentWorkspace) : undefined
  const statusOf = (it: Item): string => (it.kind === 'service' ? svcStatus(app.svcStates[it.refId]) : '')

  // ---- floating session strip: every running service/command, across all
  // spaces, each tinted with its space's color ----
  const spaceColorOf = (spaceId: number) => model.spaceById.get(spaceId)?.color ?? '#5a6070'
  const stripSessions = useMemo(() => {
    return Object.values(app.svcStates)
      .filter((s) => s.status === 'running')
      .map((s) => {
        const it = model.itemsById.get('s' + s.id)
        return {
          id: s.id,
          name: it?.name ?? s.name,
          spaceId: it?.spaceId ?? -1,
          spaceName: it?.projectName ?? '',
          color: it && it.spaceId > 0 ? spaceColorOf(it.spaceId) : '#9BA3B2',
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.svcStates, model.itemsById, model.spaceById])

  // ---- actions (wired to real backend) ----
  const cmdDef = (it: Item) => app.commands.find((c) => c.id === it.refId)
  const svcDef = (it: Item) => app.services.find((s) => s.id === it.refId)

  const runCommand = (it: Item) => {
    const c = cmdDef(it)
    if (c) void widgetRunCommand(c)
    void ipc.recentBump('command', it.refId)
    void useApp.getState().refreshRecents()
    showToast('Ran ' + it.name + ' · ' + it.projectName, '#7C8CF8')
  }
  const serviceToggle = (it: Item) => {
    const s = svcDef(it)
    if (!s) return
    const running = svcStatus(app.svcStates[it.refId]) === 'running'
    void (running ? ipc.svcStop(s.id) : ipc.svcStart(s.id))
    showToast((running ? 'Stopped ' : 'Started ') + it.name, running ? '#6B7280' : '#4ADE80')
  }
  const serviceRestart = (it: Item) => {
    const s = svcDef(it)
    if (s) void ipc.svcRestart(s.id)
    showToast('Restarting ' + it.name + '…', '#FBBF24')
  }
  const openTerminal = (it: Item) => {
    const s = svcDef(it)
    void widgetOpenTerminal(s ? serviceDir(app.nodes, s) : resolveDir(app.nodes, findNode(app.nodes, it.ownerId)), it.name)
    showToast('Opened terminal · ' + it.name, '#9BA3B2')
  }

  // ---- window: collapse / expand / drag / resize ----
  const startDrag = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-nodrag]')) return
    void win().startDragging()
  }
  const startResize = (e: React.MouseEvent) => {
    e.stopPropagation()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    void win().startResizeDragging('SouthEast' as any)
  }
  // Press-and-move drags the window; press-and-release (no move) fires the
  // click. Lets the collapsed icon / strip be both draggable and clickable —
  // previously the icon's data-nodrag guard blocked dragging entirely.
  const dragOrClick = (onClick?: () => void) => (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const sx = e.screenX
    const sy = e.screenY
    let dragged = false
    const cleanup = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    const move = (ev: MouseEvent) => {
      if (!dragged && (Math.abs(ev.screenX - sx) > 4 || Math.abs(ev.screenY - sy) > 4)) {
        dragged = true
        cleanup()
        void win().startDragging()
      }
    }
    const up = () => {
      cleanup()
      if (!dragged && onClick) onClick()
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }
  // Resize the OS window for a mode and re-anchor to the docked corner.
  const placeWidget = async (m: Mode, o: 'v' | 'h', c: Corner, style?: CollapsedStyle) => {
    const s = sizeForMode(m, o, expandedSize, { style: style ?? collapsedStyle, count: stripSessions.length })
    programmaticMove.current = true
    await ipc.widgetResize(s.w, s.h)
    await positionForCorner(c, s.w, s.h)
    setTimeout(() => (programmaticMove.current = false), 220)
  }
  // Remember the full-panel size before leaving it, so it restores.
  const captureFullSize = async () => {
    if (mode !== 'full') return
    try {
      const sz = await win().innerSize()
      const sf = await win().scaleFactor()
      setExpandedSize({ w: sz.width / sf, h: sz.height / sf })
    } catch {
      /* keep prior */
    }
  }
  const goIcon = async () => {
    await captureFullSize()
    setSpaceMenuOpen(false)
    setWidgetSetOpen(false)
    setMode('icon')
    await placeWidget('icon', quickOrient, corner)
  }
  const goQuick = async () => {
    await captureFullSize()
    setMode('quick')
    await placeWidget('quick', quickOrient, corner)
  }
  const goFull = async () => {
    setMode('full')
    await placeWidget('full', quickOrient, corner)
  }
  // Clicking a strip session icon opens the quick popup scoped to its space.
  const openSessionInQuick = (spaceId: number) => {
    if (spaceId > 0) {
      setCurrentSpace(spaceId)
      const sp = model.spaceById.get(spaceId)
      if (sp) setCurrentWorkspace(sp.wsId)
    }
    void goQuick()
  }
  // Re-place the quick popup when its orientation changes.
  useEffect(() => {
    if (mode === 'quick') void placeWidget('quick', quickOrient, corner)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickOrient])

  const setCornerDock = (c: Corner) => {
    setCorner(c)
    void ipc.settingSet('widget_corner', c)
    void placeWidget(mode, quickOrient, c)
  }
  const setOrient = (o: 'v' | 'h') => {
    setQuickOrient(o)
    void ipc.settingSet('widget_quick_orientation', o)
  }
  const switchCollapsed = (style: CollapsedStyle) => {
    setCollapsedStyle(style)
    void ipc.settingSet('widget_collapsed_style', style)
    if (mode === 'icon') void placeWidget('icon', quickOrient, corner, style)
  }
  // Keep the strip's height in sync as sessions come and go.
  useEffect(() => {
    if (mode === 'icon' && collapsedStyle === 'strip') void placeWidget('icon', quickOrient, corner)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stripSessions.length])
  const setCount = (n: number) => {
    const v = Math.max(1, Math.min(8, n))
    setRecentCount(v)
    void ipc.settingSet('widget_recent_count', String(v))
  }
  const finishTour = () => {
    setTourOpen(false)
    void ipc.settingSet('widget_tour_done', '1')
  }

  const switchWorkspace = (id: number) => {
    setCurrentWorkspace(id)
    const first = model.spaces.find((s) => s.wsId === id)
    if (first) setCurrentSpace(first.id)
    setSelectMode(false)
    setSelected({})
  }
  const selectSpace = (id: number) => {
    setCurrentSpace(id)
    setSpaceMenuOpen(false)
    setView('browse')
    setSelectMode(false)
    setSelected({})
  }
  const toggleExpand = (id: number) => setExpanded((e) => ({ ...e, [id]: !e[id] }))

  // ---- counts ----
  const running = Object.values(app.svcStates).filter((s) => s.status === 'running')
  const wsProjects = useMemo(() => model.spaces.filter((s) => s.wsId === currentWorkspace).map((s) => s.id), [model.spaces, currentWorkspace])
  const runningCount = running.length
  const totalItems = app.commands.length + app.services.length

  // ---- recents display ----
  const recentItems = useMemo(() => {
    return app.recents
      .map((r) => model.itemsById.get((r.kind === 'command' ? 'c' : 's') + r.ref_id))
      .filter((x): x is Item => !!x)
      .slice(0, recentCount)
  }, [app.recents, model.itemsById, recentCount])

  // Quick-access popup list: running services first (they're what you're
  // most likely to act on), then recent commands — up to the configured count.
  const quickItems = useMemo(() => {
    const seen = new Set<string>()
    const out: Item[] = []
    for (const s of running) {
      const it = model.itemsById.get('s' + s.id)
      if (it && !seen.has(it.id)) {
        seen.add(it.id)
        out.push(it)
      }
    }
    for (const it of recentItems) {
      if (!seen.has(it.id)) {
        seen.add(it.id)
        out.push(it)
      }
    }
    return out.slice(0, Math.max(recentCount, running.length))
  }, [running, recentItems, model.itemsById, recentCount])

  const newTerminalHere = () => {
    const dir = currentSpace != null ? resolveDir(app.nodes, findNode(app.nodes, currentSpace)) : ''
    void widgetOpenTerminal(dir, 'Terminal')
    showToast('Opened terminal', '#9BA3B2')
  }

  // First-run tour: which setup steps are already satisfied.
  const tourDone: Record<string, boolean> = {
    workspace: app.nodes.some((n) => n.kind === 'workspace'),
    project: app.nodes.some((n) => n.kind === 'project'),
    command: app.commands.length > 0,
    service: app.services.length > 0,
    profile: app.profiles.length > 0,
  }

  // ================= RENDER =================
  const navBtn = (v: View, svg: React.ReactNode) => (
    <button data-nodrag onClick={() => { setView(v); setSpaceMenuOpen(false) }} title={v}
      style={css(`width:26px;height:26px;border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:${view === v ? 'rgba(124,140,248,0.16)' : 'transparent'}`)}>
      {svg}
    </button>
  )
  const navStroke = (v: View) => (view === v ? '#A7B2FF' : '#7d8494')

  // Collapsed — single floating icon. Press-and-move drags it (snaps to
  // corners); a tap opens the quick popup. A small toggle flips to the strip.
  if (mode === 'icon' && collapsedStyle === 'single') {
    return (
      <div style={css('position:fixed;inset:0')}>
        <style>{keyframes}</style>
        <div onMouseDown={dragOrClick(() => void goQuick())} title="Quick access — tap to open, drag to move"
          style={css('width:100%;height:100%;border:1px solid rgba(255,255,255,0.12);border-radius:16px;background:linear-gradient(145deg,rgba(28,31,40,0.96),rgba(18,20,27,0.96));cursor:grab;display:flex;align-items:center;justify-content:center;position:relative;box-shadow:0 16px 44px rgba(0,0,0,0.5),0 0 0 1px rgba(124,140,248,0.18)')}>
          <div style={css('width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,#7C8CF8,#4ADE80);display:flex;align-items:center;justify-content:center;color:#0c0e14;font-weight:700;font-size:17px')}>⌘</div>
          {runningCount > 0 && (
            <div style={css('position:absolute;top:-4px;right:-4px;min-width:19px;height:19px;padding:0 5px;border-radius:10px;background:#4ADE80;color:#08120b;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid #12141b')}>{runningCount}</div>
          )}
          {/* toggle → session strip */}
          <div onMouseDown={dragOrClick(() => switchCollapsed('strip'))} title="Show session strip"
            style={css('position:absolute;bottom:-3px;left:-3px;width:17px;height:17px;border-radius:6px;background:#12141b;border:1px solid rgba(255,255,255,0.14);display:flex;align-items:center;justify-content:center;cursor:pointer')}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9BA3B2" strokeWidth="2.4"><circle cx="6" cy="6" r="1.6" /><circle cx="6" cy="12" r="1.6" /><circle cx="6" cy="18" r="1.6" /><path d="M11 6h9M11 12h9M11 18h9" /></svg>
          </div>
        </div>
      </div>
    )
  }

  // Collapsed — session strip: a floating vertical column of icons, one per
  // running session (tinted by its space), then a last icon to open the full
  // widget. Everything is drag-to-move; a tap opens/acts.
  if (mode === 'icon' && collapsedStyle === 'strip') {
    const sessDot = css('position:absolute;bottom:-1px;right:-1px;width:9px;height:9px;border-radius:50%;background:#4ADE80;border:2px solid #12141b')
    return (
      <div style={css('position:fixed;inset:0')}>
        <style>{keyframes}</style>
        <div onMouseDown={dragOrClick()} style={css('width:100%;height:100%;display:flex;flex-direction:column;align-items:center;gap:8px;padding:6px 0;border:1px solid rgba(255,255,255,0.12);border-radius:18px;background:linear-gradient(180deg,rgba(28,31,40,0.96),rgba(16,18,25,0.97));box-shadow:0 16px 44px rgba(0,0,0,0.5),0 0 0 1px rgba(124,140,248,0.14);cursor:grab')}>
          {/* toggle → single icon */}
          <div onMouseDown={dragOrClick(() => switchCollapsed('single'))} title="Show single icon"
            style={css('width:22px;height:22px;border-radius:7px;background:rgba(255,255,255,0.05);display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0')}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9BA3B2" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="4" /></svg>
          </div>
          {/* sessions */}
          <div className="cw-scroll" style={css('flex:1;min-height:0;width:100%;display:flex;flex-direction:column;align-items:center;gap:8px;overflow-y:auto;overflow-x:hidden')}>
            {stripSessions.length === 0 && (
              <div style={css('width:40px;height:40px;border-radius:12px;border:1px dashed rgba(255,255,255,0.14);display:flex;align-items:center;justify-content:center;color:#4f5563;font-size:10px;flex-shrink:0')}>—</div>
            )}
            {stripSessions.map((s) => (
              <div key={s.id} onMouseDown={dragOrClick(() => openSessionInQuick(s.spaceId))} title={`${s.name}${s.spaceName ? ' · ' + s.spaceName : ''} — tap for actions`}
                style={css(`position:relative;width:40px;height:40px;border-radius:12px;background:${hexA(s.color, 0.16)};border:1px solid ${hexA(s.color, 0.5)};display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0`)}>
                <span style={{ ...css("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:14px"), color: s.color }}>{s.name[0]?.toUpperCase()}</span>
                <span style={sessDot} />
              </div>
            ))}
          </div>
          {/* divider + open-full */}
          <div style={css('width:26px;height:1px;background:rgba(255,255,255,0.1);flex-shrink:0')} />
          <div onMouseDown={dragOrClick(() => void goFull())} title="Open full widget"
            style={css('position:relative;width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#7C8CF8,#4ADE80);display:flex;align-items:center;justify-content:center;color:#0c0e14;font-weight:700;font-size:18px;cursor:pointer;flex-shrink:0')}>⌘</div>
        </div>
      </div>
    )
  }

  // Quick-access popup: a compact, movable list of recent commands + running
  // services, with a New terminal action and a button to open the full widget.
  if (mode === 'quick') {
    const horiz = quickOrient === 'h'
    const quickRow = (it: Item) => {
      const st = statusOf(it)
      const running = st === 'running'
      return (
        <button key={it.id} data-nodrag title={it.kind === 'command' ? 'Run' : running ? 'Stop' : 'Start'}
          onClick={() => (it.kind === 'command' ? runCommand(it) : serviceToggle(it))}
          style={css(`display:flex;align-items:center;gap:7px;text-align:left;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.03);border-radius:9px;cursor:pointer;padding:7px 9px;${horiz ? 'flex:0 0 auto;min-width:130px;max-width:180px' : 'width:100%'}`)}>
          <span style={{ ...css('width:8px;height:8px;border-radius:50%;flex-shrink:0'), background: it.kind === 'service' ? (running ? '#4ADE80' : '#6B7280') : it.iconColor, animation: running ? 'cw-pulse 2s ease-in-out infinite' : 'none' }} />
          <span style={css('min-width:0;display:flex;flex-direction:column;line-height:1.15')}>
            <span style={css('font-size:12px;font-weight:600;color:#E7EAF0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px')}>{it.name}</span>
            <span style={css('font-size:9.5px;color:#5a6070;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:150px')}>{it.kind === 'service' ? (running ? 'running' : 'service') : it.projectName}</span>
          </span>
        </button>
      )
    }
    return (
      <div style={css('position:fixed;inset:0;font-family:Geist,system-ui,sans-serif;user-select:none')}>
        <style>{keyframes}</style>
        <div style={css('width:100%;height:100%;display:flex;flex-direction:column;border:1px solid rgba(255,255,255,0.1);border-radius:14px;overflow:hidden;background:linear-gradient(180deg,rgba(24,27,35,0.98),rgba(16,18,25,0.98))')}>
          {/* header / drag bar */}
          <div onMouseDown={startDrag} style={css('flex-shrink:0;display:flex;align-items:center;gap:6px;padding:8px 8px 8px 10px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:grab')}>
            <div style={css('width:20px;height:20px;border-radius:6px;background:linear-gradient(135deg,#7C8CF8,#4ADE80);display:flex;align-items:center;justify-content:center;color:#0c0e14;font-weight:700;font-size:12px;flex-shrink:0')}>⌘</div>
            <span style={css('flex:1;min-width:0;font-size:12px;font-weight:600;color:#E7EAF0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{curSpace?.name ?? 'Quick access'}</span>
            <button data-nodrag onClick={() => setWidgetSetOpen((v) => !v)} title="Widget settings" style={css('width:24px;height:24px;border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.04)')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9BA3B2" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 00-1.7-1L14.5 2h-4l-.3 2.6a7 7 0 00-1.7 1l-2.4-1-2 3.4L4 11a7 7 0 000 2l-2 1.5 2 3.4 2.4-1a7 7 0 001.7 1l.3 2.6h4l.3-2.6a7 7 0 001.7-1l2.4 1 2-3.4-2-1.5a7 7 0 00.1-1z" /></svg>
            </button>
            <button data-nodrag onClick={() => void goFull()} title="Open full widget" style={css('width:24px;height:24px;border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:rgba(124,140,248,0.14)')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#A7B2FF" strokeWidth="2"><path d="M8 3H5a2 2 0 00-2 2v3M16 3h3a2 2 0 012 2v3M8 21H5a2 2 0 01-2-2v-3M16 21h3a2 2 0 002-2v-3" /></svg>
            </button>
            <button data-nodrag onClick={() => void goIcon()} title="Collapse to icon" style={css('width:24px;height:24px;border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.04)')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9BA3B2" strokeWidth="2"><path d="M4 14h6v6M20 10h-6V4M14 10l6-6M10 14l-6 6" /></svg>
            </button>
          </div>
          {/* body */}
          <div className="cw-scroll" style={css(`flex:1;min-height:0;padding:8px;display:flex;gap:6px;${horiz ? 'flex-direction:row;overflow-x:auto;overflow-y:hidden;align-items:stretch' : 'flex-direction:column;overflow-y:auto;overflow-x:hidden'}`)}>
            {quickItems.length === 0 ? (
              <div style={css('flex:1;display:flex;align-items:center;justify-content:center;text-align:center;color:#5a6070;font-size:11.5px;padding:14px')}>Run a command or start a service — it'll show up here.</div>
            ) : (
              quickItems.map(quickRow)
            )}
          </div>
          {/* footer actions */}
          <div style={css('flex-shrink:0;display:flex;gap:6px;padding:8px;border-top:1px solid rgba(255,255,255,0.06)')}>
            <button data-nodrag onClick={newTerminalHere} title="Open a terminal here" style={css('flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:7px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);border-radius:8px;cursor:pointer;color:#C7CCD6;font-size:11.5px;font-weight:600')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9BA3B2" strokeWidth="2"><path d="M4 17l6-5-6-5M12 19h8" /></svg>Terminal
            </button>
            <button data-nodrag onClick={() => void goFull()} title="Open the full widget" style={css('flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:7px;border:none;background:rgba(124,140,248,0.16);border-radius:8px;cursor:pointer;color:#A7B2FF;font-size:11.5px;font-weight:600')}>
              Open full
            </button>
          </div>
          {widgetSetOpen && <WidgetSettings corner={corner} orient={quickOrient} count={recentCount} onCorner={setCornerDock} onOrient={setOrient} onCount={setCount} onClose={() => setWidgetSetOpen(false)} onTour={() => { setWidgetSetOpen(false); setTourOpen(true); void goFull() }} />}
        </div>
      </div>
    )
  }

  return (
    <div style={css('position:fixed;inset:0;font-family:Geist,system-ui,sans-serif;user-select:none')}>
      <style>{keyframes}</style>
      <div style={css('width:100%;height:100%;display:flex;flex-direction:column;border:1px solid rgba(255,255,255,0.1);border-radius:14px;overflow:hidden;background:radial-gradient(1100px 700px at 78% 12%,rgba(124,140,248,0.14),transparent 60%),linear-gradient(180deg,rgba(24,27,35,0.98),rgba(16,18,25,0.98))')}>

        {/* HEADER / drag bar */}
        <div onMouseDown={startDrag} style={css('flex-shrink:0;display:flex;align-items:center;gap:7px;padding:9px 9px 9px 10px;border-bottom:1px solid rgba(255,255,255,0.06);cursor:grab;background:rgba(255,255,255,0.015)')}>
          {/* space selector */}
          <div style={css('position:relative;min-width:0;flex:1')}>
            <button data-nodrag onClick={() => setSpaceMenuOpen((v) => !v)}
              style={css('display:flex;align-items:center;gap:7px;max-width:100%;padding:5px 8px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.03);cursor:pointer;min-width:0')}>
              <span style={{ ...css('width:9px;height:9px;border-radius:3px;flex-shrink:0'), background: curSpace?.color ?? '#5a6070' }} />
              <span style={css('min-width:0;display:flex;flex-direction:column;align-items:flex-start;line-height:1.1')}>
                <span style={css('font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#5a6070;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%')}>{curWs?.name ?? 'All spaces'}</span>
                <span style={css('font-size:12.5px;font-weight:600;color:#E7EAF0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%')}>{curSpace?.name ?? 'Everything'}</span>
              </span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#7d8494" strokeWidth="2.4" style={{ flexShrink: 0 }}><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {spaceMenuOpen && (
              <div data-nodrag style={css('position:absolute;top:calc(100% + 6px);left:0;z-index:40;min-width:230px;padding:6px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);background:#1b1e27;box-shadow:0 18px 46px rgba(0,0,0,0.6);animation:cw-pop .13s ease')}>
                <div style={css('padding:4px 9px 5px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#5a6070;font-weight:600')}>Workspace</div>
                {model.workspaces.map((w) => {
                  const active = w.id === currentWorkspace
                  return (
                    <button key={w.id} onClick={() => switchWorkspace(w.id)} style={css(`display:flex;align-items:center;gap:9px;width:100%;padding:7px 9px;border:none;border-radius:8px;cursor:pointer;background:${active ? 'rgba(124,140,248,0.12)' : 'transparent'}`)}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={active ? '#A7B2FF' : '#7d8494'} strokeWidth="2" style={{ flexShrink: 0 }}><path d="M3 21V7l9-4 9 4v14" /><path d="M9 21v-6h6v6" /></svg>
                      <span style={{ ...css('flex:1;text-align:left;font-size:12.5px;font-weight:600'), color: active ? '#E7EAF0' : '#C6CBD6' }}>{w.name}</span>
                      {active && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7C8CF8" strokeWidth="2.6"><path d="M20 6L9 17l-5-5" /></svg>}
                    </button>
                  )
                })}
                <div style={css('height:1px;background:rgba(255,255,255,0.07);margin:6px 4px')} />
                <div style={css('padding:2px 9px 5px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#5a6070;font-weight:600')}>Spaces</div>
                {model.spaces.filter((sp) => sp.wsId === currentWorkspace).map((sp) => {
                  const active = sp.id === currentSpace
                  const count = app.commands.filter((c) => c.project_id === sp.id).length + app.services.filter((s) => s.project_id === sp.id).length
                  return (
                    <button key={sp.id} onClick={() => selectSpace(sp.id)} style={css(`display:flex;align-items:center;gap:9px;width:100%;padding:7px 9px;border:none;border-radius:8px;cursor:pointer;background:${active ? 'rgba(124,140,248,0.12)' : 'transparent'}`)}>
                      <span style={{ ...css('width:9px;height:9px;border-radius:3px'), background: sp.color }} />
                      <span style={css('flex:1;text-align:left;font-size:12.5px;font-weight:500;color:#E7EAF0')}>{sp.name}</span>
                      <span style={css('font-size:11px;color:#5a6070')}>{count}</span>
                      {active && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7C8CF8" strokeWidth="2.6"><path d="M20 6L9 17l-5-5" /></svg>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* view switcher */}
          <div data-nodrag style={css('display:flex;align-items:center;gap:1px;padding:3px;border-radius:9px;background:rgba(0,0,0,0.28)')}>
            {navBtn('recent', <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={navStroke('recent')} strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>)}
            <div style={{ position: 'relative' }}>
              {navBtn('active', <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={navStroke('active')} strokeWidth="2" strokeLinejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>)}
              {runningCount > 0 && <span style={css('position:absolute;top:2px;right:2px;width:6px;height:6px;border-radius:50%;background:#4ADE80;pointer-events:none')} />}
            </div>
            {navBtn('browse', <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={navStroke('browse')} strokeWidth="2"><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 12l9 4 9-4M3 17l9 4 9-4" /></svg>)}
            {navBtn('search', <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={navStroke('search')} strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>)}
          </div>

          <button data-nodrag onClick={() => setWidgetSetOpen((v) => !v)} title="Widget settings (dock, quick list)" style={css('width:26px;height:26px;border:none;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.04)')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9BA3B2" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1v.2a2 2 0 01-4 0v-.1A1.6 1.6 0 006 20.9l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.6 1.6 0 003.5 15H3.3a2 2 0 010-4h.1A1.6 1.6 0 004.9 8.3l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 014 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1h.2a2 2 0 010 4h-.1a1.6 1.6 0 00-1.5 1z" /></svg>
          </button>
          <button data-nodrag onClick={() => void goIcon()} title="Collapse to icon" style={css('width:26px;height:26px;border:none;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.04)')}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9BA3B2" strokeWidth="2"><path d="M9 4v16M4 9l-1 3 1 3" /><path d="M14 8l4 4-4 4" /></svg>
          </button>
        </div>

        {/* BODY */}
        <div className="cw-scroll" style={css('flex:1;overflow-y:auto;overflow-x:hidden;min-height:0')}>
          {view === 'recent' && <RecentBody items={recentItems} d={d} recentCount={recentCount} statusOf={statusOf} onRun={runCommand} onToggle={serviceToggle} onRestart={serviceRestart} onTerminal={openTerminal} />}
          {view === 'active' && <ActiveBody model={model} app={app} d={d} wsProjects={wsProjects} curWsName={curWs?.name ?? ''} onToggle={serviceToggle} onRestart={serviceRestart} onTerminal={openTerminal} />}
          {view === 'browse' && <BrowseBody model={model} app={app} d={d} spaceId={currentSpace} spaceName={curSpace?.name ?? ''} expanded={expanded} toggleExpand={toggleExpand} selectMode={selectMode} setSelectMode={setSelectMode} selected={selected} setSelected={setSelected} statusOf={statusOf} onRun={runCommand} onToggle={serviceToggle} onTerminal={openTerminal} showToast={showToast} setView={setView} />}
          {view === 'search' && <SearchBody model={model} app={app} d={d} query={query} setQuery={setQuery} filter={filter} setFilter={setFilter} selIndex={selIndex} setSelIndex={setSelIndex} searchRef={searchRef} statusOf={statusOf} onRun={runCommand} onToggle={serviceToggle} selectSpace={selectSpace} />}
        </div>

        {/* FOOTER */}
        <div style={css('flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:6px 11px;border-top:1px solid rgba(255,255,255,0.06);background:rgba(0,0,0,0.16)')}>
          <span style={css('font-size:10.5px;color:#4f5563;display:flex;align-items:center;gap:6px')}>
            <span style={css('width:6px;height:6px;border-radius:50%;background:#4ADE80')} />{runningCount} running · {totalItems} actions
          </span>
          <button onClick={() => setShortcutOpen((v) => !v)} title="Keyboard shortcuts" style={css('border:none;background:transparent;cursor:pointer;font-size:10.5px;color:#656C7A;display:flex;align-items:center;gap:4px')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#656C7A" strokeWidth="1.8"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></svg>
            {app.hotkey}
          </button>
        </div>

        {shortcutOpen && (
          <div data-nodrag onClick={() => setShortcutOpen(false)} style={css('position:absolute;inset:0;z-index:60;background:rgba(8,9,13,0.55);display:flex;align-items:center;justify-content:center;padding:16px;animation:cw-fade .12s ease')}>
            <div onClick={(e) => e.stopPropagation()} style={css('width:100%;background:#1b1e27;border:1px solid rgba(255,255,255,0.12);border-radius:13px;padding:14px;box-shadow:0 18px 50px rgba(0,0,0,0.6);animation:cw-pop .14s ease')}>
              <div style={css('font-size:13px;font-weight:600;color:#E7EAF0;margin-bottom:12px')}>Keyboard shortcuts</div>
              {[['Summon widget & search', app.hotkey], ['Navigate results', '↑ ↓'], ['Run / open selected', 'Enter'], ['Clear / dismiss', 'Esc']].map(([l, k]) => (
                <div key={l} style={css('display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:7px')}>
                  <span style={css('font-size:12px;color:#9BA3B2')}>{l}</span>
                  <kbd style={css("font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#E7EAF0;padding:3px 7px;border-radius:6px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);white-space:nowrap")}>{k}</kbd>
                </div>
              ))}
            </div>
          </div>
        )}

        {widgetSetOpen && <WidgetSettings corner={corner} orient={quickOrient} count={recentCount} onCorner={setCornerDock} onOrient={setOrient} onCount={setCount} onClose={() => setWidgetSetOpen(false)} onTour={() => { setWidgetSetOpen(false); setTourOpen(true) }} />}

        {tourOpen && <TourView done={tourDone} onAction={(a) => void ipc.emitTourAction(a)} onFinish={finishTour} />}

        {toast && (
          <div style={css('position:absolute;bottom:44px;left:50%;z-index:55;transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:8px 13px;border-radius:10px;background:#22262f;border:1px solid rgba(255,255,255,0.12);box-shadow:0 12px 34px rgba(0,0,0,0.5);animation:cw-toast .18s ease;max-width:90%')}>
            <span style={{ ...css('width:7px;height:7px;border-radius:50%;flex-shrink:0'), background: toast.color }} />
            <span style={css('font-size:12px;color:#E7EAF0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{toast.msg}</span>
          </div>
        )}

        {/* resize handle */}
        <div onMouseDown={startResize} title="Resize" style={css('position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;z-index:50')}>
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ position: 'absolute', right: 2, bottom: 2 }}><path d="M16 8L8 16M16 13l-3 3" stroke="rgba(255,255,255,0.22)" strokeWidth="1.6" fill="none" strokeLinecap="round" /></svg>
        </div>
      </div>
    </div>
  )
}

const keyframes = `
@keyframes cw-pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes cw-toast{from{opacity:0;transform:translate(-50%,8px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes cw-pop{from{opacity:0;transform:scale(.96) translateY(6px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes cw-fade{from{opacity:0}to{opacity:1}}
.cw-scroll::-webkit-scrollbar{width:8px}
.cw-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.10);border-radius:8px}
`

type D = typeof DENSITY['compact']

// Widget settings popover: corner dock, quick-list orientation, and how many
// recent/active items the quick popup shows.
function WidgetSettings({ corner, orient, count, onCorner, onOrient, onCount, onClose, onTour }: {
  corner: Corner; orient: 'v' | 'h'; count: number
  onCorner: (c: Corner) => void; onOrient: (o: 'v' | 'h') => void; onCount: (n: number) => void
  onClose: () => void; onTour: () => void
}) {
  const row = css('display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px')
  const label = css('font-size:11.5px;color:#9BA3B2')
  const seg = (active: boolean) => css(`min-width:30px;height:26px;padding:0 8px;border:1px solid ${active ? 'rgba(124,140,248,0.5)' : 'rgba(255,255,255,0.1)'};background:${active ? 'rgba(124,140,248,0.18)' : 'rgba(255,255,255,0.03)'};color:${active ? '#A7B2FF' : '#9BA3B2'};border-radius:7px;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center`)
  return (
    <div data-nodrag onClick={onClose} style={css('position:absolute;inset:0;z-index:60;background:rgba(8,9,13,0.55);display:flex;align-items:center;justify-content:center;padding:14px;animation:cw-fade .12s ease')}>
      <div onClick={(e) => e.stopPropagation()} style={css('width:100%;max-width:280px;background:#1b1e27;border:1px solid rgba(255,255,255,0.12);border-radius:13px;padding:14px;box-shadow:0 18px 50px rgba(0,0,0,0.6);animation:cw-pop .14s ease')}>
        <div style={css('font-size:13px;font-weight:600;color:#E7EAF0;margin-bottom:13px')}>Widget settings</div>

        <div style={row}>
          <span style={label}>Dock to corner</span>
          <div style={css('display:flex;gap:3px')}>
            {CORNERS.map((c) => (
              <button key={c.key} title={c.key === 'free' ? 'Free (drag anywhere)' : 'Dock ' + c.key} onClick={() => onCorner(c.key)} style={seg(corner === c.key)}>{c.label}</button>
            ))}
          </div>
        </div>

        <div style={row}>
          <span style={label}>Quick list</span>
          <div style={css('display:flex;gap:3px')}>
            <button onClick={() => onOrient('v')} style={seg(orient === 'v')}>Vertical</button>
            <button onClick={() => onOrient('h')} style={seg(orient === 'h')}>Horizontal</button>
          </div>
        </div>

        <div style={row}>
          <span style={label}>Show how many</span>
          <div style={css('display:flex;align-items:center;gap:6px')}>
            <button onClick={() => onCount(count - 1)} style={seg(false)}>−</button>
            <span style={css('min-width:18px;text-align:center;font-size:13px;color:#E7EAF0;font-weight:600')}>{count}</span>
            <button onClick={() => onCount(count + 1)} style={seg(false)}>+</button>
          </div>
        </div>

        <button onClick={onTour} style={css('width:100%;margin-top:4px;padding:8px;border:1px solid rgba(124,140,248,0.3);background:rgba(124,140,248,0.1);border-radius:8px;color:#A7B2FF;font-size:12px;font-weight:600;cursor:pointer')}>↻ Restart setup tour</button>
      </div>
    </div>
  )
}

// First-run guided setup. Each step opens the matching create flow in the
// main window and ticks off once that kind of entity exists.
function TourView({ done, onAction, onFinish }: {
  done: Record<string, boolean>
  onAction: (a: ipc.TourAction) => void
  onFinish: () => void
}) {
  const steps: { key: string; action: ipc.TourAction; title: string; hint: string }[] = [
    { key: 'workspace', action: 'workspace', title: 'Create a workspace', hint: 'A top-level group for related projects.' },
    { key: 'project', action: 'project', title: 'Add a project (space)', hint: 'Point it at a repo or app folder.' },
    { key: 'command', action: 'command', title: 'Save a command', hint: 'e.g. npm run dev — runs in the project.' },
    { key: 'service', action: 'service', title: 'Add a service', hint: 'A long-running dev server, with a port.' },
    { key: 'profile', action: 'profile', title: 'Create a launch profile', hint: 'Boot several things in one click.' },
  ]
  const total = steps.length
  const doneCount = steps.filter((s) => done[s.key]).length
  const nextIdx = steps.findIndex((s) => !done[s.key])
  return (
    <div data-nodrag style={css('position:absolute;inset:0;z-index:62;background:linear-gradient(180deg,rgba(16,18,25,0.98),rgba(12,14,20,0.99));display:flex;flex-direction:column;padding:14px;animation:cw-fade .14s ease')}>
      <div style={css('display:flex;align-items:center;gap:9px;margin-bottom:4px')}>
        <div style={css('width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#7C8CF8,#4ADE80);display:flex;align-items:center;justify-content:center;color:#0c0e14;font-weight:700;font-size:14px')}>✦</div>
        <div style={css('flex:1;min-width:0')}>
          <div style={css('font-size:14px;font-weight:700;color:#E7EAF0')}>Welcome to DevDeck</div>
          <div style={css('font-size:11px;color:#7d8494')}>Let's set up your first workspace</div>
        </div>
        <button onClick={onFinish} title="Skip" style={css('border:none;background:rgba(255,255,255,0.05);color:#9BA3B2;border-radius:7px;padding:5px 9px;font-size:11px;cursor:pointer')}>Skip</button>
      </div>

      {/* progress */}
      <div style={css('height:5px;border-radius:3px;background:rgba(255,255,255,0.07);margin:8px 0 12px;overflow:hidden')}>
        <div style={{ ...css('height:100%;border-radius:3px;background:linear-gradient(90deg,#7C8CF8,#4ADE80);transition:width .3s ease'), width: `${(doneCount / total) * 100}%` }} />
      </div>

      <div className="cw-scroll" style={css('flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:7px')}>
        {steps.map((s, i) => {
          const complete = done[s.key]
          const active = i === nextIdx
          return (
            <div key={s.key} style={css(`display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;border:1px solid ${active ? 'rgba(124,140,248,0.4)' : 'rgba(255,255,255,0.06)'};background:${active ? 'rgba(124,140,248,0.08)' : 'rgba(255,255,255,0.02)'}`)}>
              <div style={{ ...css('width:22px;height:22px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700'), background: complete ? '#4ADE80' : 'rgba(255,255,255,0.08)', color: complete ? '#08120b' : '#9BA3B2' }}>{complete ? '✓' : i + 1}</div>
              <div style={css('flex:1;min-width:0')}>
                <div style={{ ...css('font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'), color: complete ? '#8b93a1' : '#E7EAF0', textDecoration: complete ? 'line-through' : 'none' }}>{s.title}</div>
                <div style={css('font-size:10.5px;color:#656C7A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{s.hint}</div>
              </div>
              {!complete && (
                <button onClick={() => onAction(s.action)} style={{ ...css('border:none;border-radius:7px;padding:6px 11px;font-size:11.5px;font-weight:600;cursor:pointer'), background: active ? '#7C8CF8' : 'rgba(255,255,255,0.06)', color: active ? '#fff' : '#C7CCD6' }}>Do it</button>
              )}
            </div>
          )
        })}
      </div>

      <button onClick={onFinish} style={{ ...css('margin-top:11px;width:100%;padding:10px;border:none;border-radius:9px;font-size:12.5px;font-weight:700;cursor:pointer'), background: doneCount === total ? 'linear-gradient(135deg,#7C8CF8,#4ADE80)' : 'rgba(255,255,255,0.06)', color: doneCount === total ? '#0c0e14' : '#C7CCD6' }}>
        {doneCount === total ? '🎉 All set — start using DevDeck' : `Finish (${doneCount}/${total})`}
      </button>
    </div>
  )
}

// A generic item row matching the design's Recent/Active markup.
function ItemRow({ it, d, status, onRun, onToggle, onRestart, onTerminal }: {
  it: Item; d: D; status: string
  onRun: (it: Item) => void; onToggle: (it: Item) => void; onRestart: (it: Item) => void; onTerminal: (it: Item) => void
}) {
  const isService = it.kind === 'service'
  const [sc, anim] = isService ? statusMeta(status) : ['', 'none']
  const tv = toggleVisual(status === 'running')
  const meta = it.projectName + ' · ' + it.type + (isService ? ' · ' + status : '')
  return (
    <div style={css(`display:flex;align-items:center;gap:9px;padding:${d.padY}px 8px;min-height:${d.rowMinH}px;border-radius:9px;background:rgba(255,255,255,0.028);border:1px solid rgba(255,255,255,0.04)`)}>
      <div style={css(`width:${d.icon}px;height:${d.icon}px;border-radius:${d.rad}px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-weight:600;font-size:11px;color:${it.iconColor};background:${it.iconBg}`)}>{it.name[0]?.toUpperCase()}</div>
      <div style={css('flex:1;min-width:0')}>
        <div style={css('display:flex;align-items:center;gap:6px')}>
          <span style={css(`font-family:'JetBrains Mono',monospace;font-size:${d.name}px;font-weight:500;color:#E7EAF0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{it.name}</span>
          {isService && <span style={{ ...css('flex-shrink:0;width:6px;height:6px;border-radius:50%'), background: sc, animation: anim }} />}
        </div>
        <div style={css(`font-size:${d.meta}px;color:#656C7A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{meta}</div>
      </div>
      <div style={css('display:flex;align-items:center;gap:3px;flex-shrink:0')}>
        {!isService && (
          <button onClick={() => onRun(it)} title="Run" style={css('width:26px;height:26px;border:none;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:rgba(124,140,248,0.15)')}>{Icon.play()}</button>
        )}
        {isService && (
          <>
            <button onClick={() => onToggle(it)} title={tv.toggleLabel} style={css(`width:26px;height:26px;border:none;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:${tv.toggleBg}`)}><span style={css(tv.toggleIconWrap)} /></button>
            <button onClick={() => onRestart(it)} title="Restart" style={css('width:26px;height:26px;border:none;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05)')}>{Icon.restart()}</button>
            <button onClick={() => onTerminal(it)} title="Open terminal" style={css('width:26px;height:26px;border:none;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05)')}>{Icon.term()}</button>
          </>
        )}
      </div>
    </div>
  )
}

function RecentBody({ items, d, recentCount, statusOf, onRun, onToggle, onRestart, onTerminal }: {
  items: Item[]; d: D; recentCount: number; statusOf: (it: Item) => string
  onRun: (it: Item) => void; onToggle: (it: Item) => void; onRestart: (it: Item) => void; onTerminal: (it: Item) => void
}) {
  return (
    <div>
      <div style={css(`display:flex;align-items:center;justify-content:space-between;padding:11px ${d.padX}px 6px`)}>
        <span style={css('font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#656C7A;font-weight:600')}>Recent · commands &amp; services</span>
        <span style={css('font-size:11px;color:#4f5563')}>top {recentCount}</span>
      </div>
      <div style={css(`padding:0 ${d.padX}px ${d.padX}px;display:flex;flex-direction:column;gap:4px`)}>
        {items.length === 0 && <div style={css('padding:22px 10px;text-align:center;color:#5a6070;font-size:12.5px')}>Nothing run yet.<br /><span style={css('font-size:11.5px;color:#4f5563')}>Run a command or start a service.</span></div>}
        {items.map((it) => <ItemRow key={it.id} it={it} d={d} status={statusOf(it)} onRun={onRun} onToggle={onToggle} onRestart={onRestart} onTerminal={onTerminal} />)}
      </div>
    </div>
  )
}

function ActiveBody({ model, app, d, wsProjects, curWsName, onToggle, onRestart, onTerminal }: {
  model: ReturnType<typeof buildModelType>; app: ReturnType<typeof useApp.getState>; d: D; wsProjects: number[]; curWsName: string
  onToggle: (it: Item) => void; onRestart: (it: Item) => void; onTerminal: (it: Item) => void
}) {
  // Running services in the current workspace + ephemeral background command runs.
  const rows: Item[] = []
  model.itemsById.forEach((it) => {
    if (it.kind === 'service' && wsProjects.includes(it.spaceId)) {
      const st = svcStatus(app.svcStates[it.refId])
      if (st === 'running') rows.push(it)
    }
  })
  const empty = rows.length === 0
  return (
    <div>
      <div style={css(`padding:11px ${d.padX}px 6px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#656C7A;font-weight:600`)}>Running now · {curWsName}</div>
      <div style={css(`padding:0 ${d.padX}px ${d.padX}px;display:flex;flex-direction:column;gap:4px`)}>
        {rows.map((it) => <ItemRow key={it.id} it={it} d={d} status={svcStatus(app.svcStates[it.refId])} onRun={() => {}} onToggle={onToggle} onRestart={onRestart} onTerminal={onTerminal} />)}
        {empty && <div style={css('padding:22px 10px;text-align:center;color:#5a6070;font-size:12.5px')}>Nothing running in {curWsName}.<br /><span style={css('font-size:11.5px;color:#4f5563')}>Start a service from Browse or Recent.</span></div>}
      </div>
    </div>
  )
}

// Tree flattener for the Browse view — DevDeck: project → folders → items.
function BrowseBody({ model, app, d, spaceId, spaceName, expanded, toggleExpand, selectMode, setSelectMode, selected, setSelected, statusOf, onRun, onToggle, onTerminal, showToast, setView }: {
  model: ReturnType<typeof buildModelType>; app: ReturnType<typeof useApp.getState>; d: D; spaceId: number | null; spaceName: string
  expanded: Record<number, boolean>; toggleExpand: (id: number) => void
  selectMode: boolean; setSelectMode: (f: (v: boolean) => boolean) => void
  selected: Record<string, boolean>; setSelected: (s: Record<string, boolean>) => void
  statusOf: (it: Item) => string; onRun: (it: Item) => void; onToggle: (it: Item) => void; onTerminal: (it: Item) => void
  showToast: (m: string, c?: string) => void; setView: (v: View) => void
}) {
  const nodes = app.nodes
  const itemsFor = (ownerId: number): Item[] => {
    const out: Item[] = []
    app.commands.filter((c) => c.project_id === ownerId).forEach((c) => { const it = model.itemsById.get('c' + c.id); if (it) out.push(it) })
    app.services.filter((s) => s.project_id === ownerId).forEach((s) => { const it = model.itemsById.get('s' + s.id); if (it) out.push(it) })
    return out
  }
  const foldersOf = (id: number) => nodes.filter((n) => n.parent_id === id && n.kind === 'folder')

  const flat: React.ReactNode[] = []
  const IND = (dep: number) => 6 + dep * 15
  const checkStyle = (on: boolean) => `width:16px;height:16px;flex-shrink:0;border-radius:5px;display:flex;align-items:center;justify-content:center;background:${on ? '#7C8CF8' : 'transparent'};border:1.5px solid ${on ? '#7C8CF8' : 'rgba(255,255,255,0.25)'}`

  const itemRow = (it: Item, dep: number) => {
    const isService = it.kind === 'service'
    const st = statusOf(it)
    const [sc, anim] = isService ? statusMeta(st) : ['', 'none']
    const checked = !!selected[it.id]
    const tv = toggleVisual(st === 'running')
    const onRow = selectMode ? () => setSelected({ ...selected, [it.id]: !selected[it.id] }) : (isService ? () => onToggle(it) : () => onRun(it))
    return (
      <div key={it.id} style={css(`display:flex;align-items:center;gap:6px;min-height:${d.rowMinH}px;border-radius:8px;padding-right:6px;background:${checked ? 'rgba(124,140,248,0.1)' : 'transparent'}`)}>
        <button onClick={onRow} style={css(`flex:1;min-width:0;display:flex;align-items:center;gap:7px;padding:${d.padY}px 6px;padding-left:${IND(dep)}px;border:none;background:transparent;cursor:pointer;text-align:left`)}>
          {selectMode ? <span style={css(checkStyle(checked))}>{checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#0c0e14" strokeWidth="3.5"><path d="M20 6L9 17l-5-5" /></svg>}</span> : <span style={css('width:6px;flex-shrink:0')} />}
          <div style={css(`width:${d.icon}px;height:${d.icon}px;border-radius:${d.rad}px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-weight:600;font-size:11px;color:${it.iconColor};background:${it.iconBg}`)}>{it.name[0]?.toUpperCase()}</div>
          <div style={css('flex:1;min-width:0')}>
            <div style={css('display:flex;align-items:center;gap:6px')}>
              <span style={css(`font-family:'JetBrains Mono',monospace;font-size:${d.name}px;font-weight:500;color:#E7EAF0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{it.name}</span>
              {isService && <span style={{ ...css('flex-shrink:0;width:6px;height:6px;border-radius:50%'), background: sc, animation: anim }} />}
            </div>
            <div style={css(`font-size:${d.meta}px;color:#656C7A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{it.type + (isService ? ' · ' + st : ' · command')}</div>
          </div>
        </button>
        {!selectMode && (
          <div style={css('display:flex;align-items:center;gap:3px;flex-shrink:0')}>
            {!isService && <button onClick={() => onRun(it)} title="Run" style={css('width:24px;height:24px;border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:rgba(124,140,248,0.15)')}>{Icon.play('#8E9CFF', 12)}</button>}
            {isService && <>
              <button onClick={() => onToggle(it)} title={tv.toggleLabel} style={css(`width:24px;height:24px;border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:${tv.toggleBg}`)}><span style={css(tv.toggleIconWrap)} /></button>
              <button onClick={() => onTerminal(it)} title="Open terminal" style={css('width:24px;height:24px;border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.05)')}>{Icon.term(12)}</button>
            </>}
          </div>
        )}
      </div>
    )
  }

  const folderRow = (folder: TreeNode, dep: number) => {
    const open = !!expanded[folder.id]
    const kids = foldersOf(folder.id)
    const items = itemsFor(folder.id)
    flat.push(
      <div key={'f' + folder.id} style={css('display:flex;align-items:center;gap:6px;border-radius:8px')}>
        <button onClick={() => toggleExpand(folder.id)} style={css(`flex:1;min-width:0;display:flex;align-items:center;gap:7px;padding:${d.padY}px 6px;padding-left:${IND(dep)}px;border:none;background:transparent;cursor:pointer;text-align:left`)}>
          {Icon.chev(open ? 'rotate(90deg)' : 'none')}
          <div style={css(`width:${d.icon}px;height:${d.icon}px;border-radius:${d.rad}px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-weight:600;font-size:11px;color:#9BA3B2;background:rgba(255,255,255,0.06)`)}>{folder.name[0]?.toUpperCase()}</div>
          <div style={css('flex:1;min-width:0')}>
            <span style={css(`font-family:Geist,sans-serif;font-size:${d.name}px;font-weight:500;color:#E7EAF0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block`)}>{folder.name}</span>
            <div style={css(`font-size:${d.meta}px;color:#656C7A`)}>{items.length + kids.length} actions</div>
          </div>
        </button>
      </div>,
    )
    if (open) {
      kids.forEach((k) => folderRow(k, dep + 1))
      items.forEach((it) => flat.push(itemRow(it, dep + 1)))
    }
  }

  if (spaceId != null) {
    const project = findNode(nodes, spaceId)
    if (project) {
      itemsFor(project.id).forEach((it) => flat.push(itemRow(it, 0)))
      foldersOf(project.id).forEach((f) => folderRow(f, 0))
    }
  }

  const selCount = Object.keys(selected).filter((k) => selected[k]).length

  return (
    <>
      <div style={css(`display:flex;align-items:center;justify-content:space-between;padding:10px ${d.padX}px 7px`)}>
        <span style={css('font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#656C7A;font-weight:600')}>{spaceName} · tree</span>
        <button onClick={() => { setSelectMode((v) => !v); setSelected({}) }} style={css(`display:flex;align-items:center;gap:5px;padding:4px 9px;border-radius:7px;cursor:pointer;font-size:11px;font-weight:600;border:1px solid ${selectMode ? 'rgba(124,140,248,0.4)' : 'rgba(255,255,255,0.1)'};background:${selectMode ? 'rgba(124,140,248,0.14)' : 'rgba(255,255,255,0.03)'};color:${selectMode ? '#A7B2FF' : '#9BA3B2'}`)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={selectMode ? '#A7B2FF' : '#9BA3B2'} strokeWidth="2.2"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>
          {selectMode ? 'Done' : 'Select'}
        </button>
      </div>
      <div style={css(`padding:0 ${d.padX}px ${d.padX}px;display:flex;flex-direction:column;gap:2px`)}>
        {flat.length === 0 && <div style={css('padding:22px 10px;text-align:center;color:#5a6070;font-size:12.5px')}>Nothing here yet.</div>}
        {flat}
      </div>
      {selectMode && selCount > 0 && (
        <div style={css('position:sticky;bottom:0;display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:1px solid rgba(124,140,248,0.25);background:rgba(20,23,31,0.96)')}>
          <span style={css('font-size:12px;font-weight:600;color:#A7B2FF;flex-shrink:0')}>{selCount} selected</span>
          <button onClick={() => { setSelected({}); setSelectMode(() => false) }} style={css('font-size:11px;color:#9BA3B2;background:transparent;border:none;cursor:pointer')}>Clear</button>
          <div style={css('flex:1')} />
          <button onClick={() => {
            const ids = Object.keys(selected).filter((k) => selected[k])
            ids.forEach((id) => { const it = model.itemsById.get(id); if (!it) return; if (it.kind === 'command') onRun(it); else onToggle(it) })
            setSelected({}); setSelectMode(() => false); setView('active'); showToast('Started ' + ids.length + ' items', '#4ADE80')
          }} style={css('display:flex;align-items:center;gap:5px;padding:6px 11px;border:none;border-radius:8px;cursor:pointer;background:#7C8CF8;color:#0c0e14;font-size:12px;font-weight:700')}>
            {Icon.play('#0c0e14', 12)}Run all
          </button>
        </div>
      )}
    </>
  )
}

function SearchBody({ model, app, d, query, setQuery, filter, setFilter, selIndex, setSelIndex, searchRef, statusOf, onRun, onToggle, selectSpace }: {
  model: ReturnType<typeof buildModelType>; app: ReturnType<typeof useApp.getState>; d: D
  query: string; setQuery: (q: string) => void
  filter: 'all' | 'commands' | 'services' | 'projects' | 'spaces'; setFilter: (f: 'all' | 'commands' | 'services' | 'projects' | 'spaces') => void
  selIndex: number; setSelIndex: (n: number) => void; searchRef: React.RefObject<HTMLInputElement | null>
  statusOf: (it: Item) => string; onRun: (it: Item) => void; onToggle: (it: Item) => void; selectSpace: (id: number) => void
}) {
  useEffect(() => searchRef.current?.focus(), [searchRef])
  type Entry = { kind: string; item?: Item; space?: { id: number; name: string; color: string }; name: string }
  const entries: Entry[] = useMemo(() => {
    const out: Entry[] = []
    model.itemsById.forEach((it) => out.push({ kind: it.kind, item: it, name: it.name }))
    model.spaces.forEach((sp) => out.push({ kind: 'space', space: sp, name: sp.name }))
    return out
  }, [model])
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = entries
    if (filter === 'commands') list = list.filter((e) => e.kind === 'command')
    else if (filter === 'services') list = list.filter((e) => e.kind === 'service')
    else if (filter === 'spaces') list = list.filter((e) => e.kind === 'space')
    else if (filter === 'projects') list = list.filter((e) => e.kind === 'space')
    if (q) list = list.filter((e) => e.name.toLowerCase().includes(q))
    return list.slice(0, 12)
  }, [entries, query, filter])
  const exec = (e: Entry) => {
    if (e.kind === 'command' && e.item) onRun(e.item)
    else if (e.kind === 'service' && e.item) onToggle(e.item)
    else if (e.kind === 'space' && e.space) selectSpace(e.space.id)
  }
  const kindTag: Record<string, [string, string, string]> = {
    command: ['#8E9CFF', 'rgba(124,140,248,0.14)', 'Cmd'],
    service: ['#4ADE80', 'rgba(74,222,128,0.14)', 'Svc'],
    space: ['#F472B6', 'rgba(244,114,182,0.14)', 'Space'],
  }
  return (
    <>
      <div style={css(`padding:10px ${d.padX}px 4px`)}>
        <div style={css('display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:10px;border:1px solid rgba(124,140,248,0.35);background:rgba(124,140,248,0.07)')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8E9CFF" strokeWidth="2" style={{ flexShrink: 0 }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input ref={searchRef} value={query} onChange={(e) => { setQuery(e.target.value); setSelIndex(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSelIndex(Math.min(selIndex + 1, results.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSelIndex(Math.max(selIndex - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); const r = results[selIndex]; if (r) exec(r) }
              else if (e.key === 'Escape') setQuery('')
            }}
            placeholder="Search commands, services, spaces…"
            style={css("flex:1;min-width:0;border:none;background:transparent;outline:none;color:#E7EAF0;font-family:Geist,sans-serif;font-size:13px")} />
          <kbd style={css("flex-shrink:0;font-family:'JetBrains Mono',monospace;font-size:10px;color:#656C7A;padding:2px 5px;border-radius:5px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08)")}>{app.hotkey}</kbd>
        </div>
        <div style={css('display:flex;gap:5px;margin-top:8px;flex-wrap:wrap')}>
          {(['all', 'commands', 'services', 'projects', 'spaces'] as const).map((f) => (
            <button key={f} onClick={() => { setFilter(f); setSelIndex(0) }} style={css(`border:1px solid ${filter === f ? 'rgba(124,140,248,0.4)' : 'rgba(255,255,255,0.08)'};background:${filter === f ? 'rgba(124,140,248,0.14)' : 'rgba(255,255,255,0.03)'};color:${filter === f ? '#A7B2FF' : '#9BA3B2'};font-size:11px;font-weight:500;padding:4px 9px;border-radius:7px;cursor:pointer;text-transform:capitalize`)}>{f}</button>
          ))}
        </div>
      </div>
      <div style={css(`padding:2px ${d.padX}px 4px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#656C7A;font-weight:600`)}>{query ? 'Results' : 'Frequent & recent'}</div>
      <div style={css(`padding:0 ${d.padX}px ${d.padX}px;display:flex;flex-direction:column;gap:3px`)}>
        {results.length === 0 && <div style={css('padding:26px 10px;text-align:center;color:#5a6070;font-size:12.5px')}>No matches{query ? ` for “${query}”` : ''}</div>}
        {results.map((e, i) => {
          const [tc, tb, tag] = kindTag[e.kind] || ['#9BA3B2', 'rgba(255,255,255,0.07)', e.kind]
          const sel = i === selIndex
          const it = e.item
          const isSvc = e.kind === 'service'
          const st = isSvc && it ? statusOf(it) : ''
          const [sc, anim] = isSvc ? statusMeta(st) : ['', 'none']
          const iconColor = e.kind === 'space' ? e.space!.color : (it?.iconColor || tc)
          const iconBg = e.kind === 'space' ? 'rgba(244,114,182,0.14)' : (it?.iconBg || tb)
          const meta = it ? it.projectName + ' · ' + it.type : 'Space'
          return (
            <button key={e.kind + (it?.id ?? e.space!.id) + i} onMouseEnter={() => setSelIndex(i)} onClick={() => exec(e)}
              style={css(`display:flex;align-items:center;gap:9px;padding:${d.padY}px 8px;min-height:${d.rowMinH}px;border-radius:9px;cursor:pointer;text-align:left;width:100%;border:1px solid ${sel ? 'rgba(124,140,248,0.4)' : 'rgba(255,255,255,0.04)'};background:${sel ? 'rgba(124,140,248,0.1)' : 'rgba(255,255,255,0.022)'}`)}>
              <div style={css(`width:${d.icon}px;height:${d.icon}px;border-radius:${d.rad}px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-weight:600;font-size:11px;color:${iconColor};background:${iconBg}`)}>{e.name[0]?.toUpperCase()}</div>
              <div style={css('flex:1;min-width:0')}>
                <div style={css('display:flex;align-items:center;gap:6px')}>
                  <span style={css(`font-family:${it ? "'JetBrains Mono',monospace" : 'Geist,sans-serif'};font-size:${d.name}px;font-weight:500;color:#E7EAF0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{e.name}</span>
                  {isSvc && <span style={{ ...css('flex-shrink:0;width:6px;height:6px;border-radius:50%'), background: sc, animation: anim }} />}
                </div>
                <div style={css(`font-size:${d.meta}px;color:#656C7A;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>{meta}</div>
              </div>
              <span style={css(`flex-shrink:0;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;font-weight:600;color:${tc};background:${tb};padding:2px 6px;border-radius:5px`)}>{tag}</span>
              {sel && <kbd style={css("flex-shrink:0;font-family:'JetBrains Mono',monospace;font-size:10px;color:#8E9CFF;padding:2px 6px;border-radius:5px;background:rgba(124,140,248,0.14)")}>↵</kbd>}
            </button>
          )
        })}
      </div>
    </>
  )
}

// Helper only used for typeof in prop types above.
function buildModelType() {
  return {
    workspaces: [] as TreeNode[],
    projects: [] as TreeNode[],
    spaces: [] as { id: number; wsId: number; name: string; color: string }[],
    spaceById: new Map<number, { id: number; wsId: number; name: string; color: string }>(),
    wsById: new Map<number, TreeNode>(),
    itemsById: new Map<string, Item>(),
    wsOf: (_?: TreeNode) => undefined as TreeNode | undefined,
    projOf: (_?: TreeNode) => undefined as TreeNode | undefined,
  }
}
