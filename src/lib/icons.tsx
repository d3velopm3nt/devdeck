// Central icon registry. Everything visual goes through <Icon name="…" /> so
// the whole app draws from one consistent stroke-icon set (Lucide) instead of
// per-font emoji. Icons inherit `currentColor`, so Tailwind text-* classes
// colour them exactly like the old emoji spans did.
//
// Migration is incremental: if a name isn't a known key, <Icon> renders the
// raw string as a fallback, so panels not yet migrated keep showing their
// emoji until they're switched over.

import {
  Bot,
  Crosshair,
  Sparkle,
  TriangleAlert,
  Diamond,
  Gavel,
  Pause,
  GitCommitHorizontal,
  GitPullRequest,
  CircleDot,
  Boxes,
  CalendarClock,
  Inbox,
  Box,
  Folder,
  FolderOpen,
  SquareTerminal,
  Zap,
  Layers,
  Check,
  Plus,
  Pencil,
  Pin,
  Trash2,
  Settings,
  Terminal,
  Eye,
  Play,
  Square,
  RotateCw,
  ScrollText,
  Globe,
  MoreHorizontal,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Sparkles,
  RefreshCw,
  Loader2,
  Download,
  CircleCheck,
  CircleAlert,
  Package,
  Wrench,
  ArrowUpRight,
  X,
  AppWindow,
  MonitorCog,
  House,
  History,
  LayoutGrid,
  Palette,
  Search,
  Import,
  Upload,
  Camera,
  Info,
  RotateCcw,
  Star,
  Puzzle,
  PartyPopper,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ChevronUp,
  ArrowRightLeft,
  Archive,
  Clipboard,
  Code,
  Link,
  Image,
  ShieldAlert,
  Copy,
  List,
  StickyNote,
  Tag,
  Database,
  Mail,
  Send,
  Paperclip,
  Users,
  Reply,
  Building2,
  Clock,
  Play as PlayIcon,
  type LucideIcon,
} from 'lucide-react'

// Semantic names — describe the *meaning*, not the glyph, so a later icon
// swap is a one-line change here.
export type IconName =
  | 'workspace'
  | 'inbox'
  | 'schedule'
  | 'solution'
  | 'project'
  | 'folder'
  | 'command'
  | 'service'
  | 'profile'
  | 'check'
  | 'add'
  | 'edit'
  | 'pin'
  | 'delete'
  | 'settings'
  | 'terminal'
  | 'view'
  | 'reveal'
  | 'run'
  | 'stop'
  | 'restart'
  | 'logs'
  | 'globe'
  | 'more'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'github'
  | 'example'
  | 'update'
  | 'spinner'
  | 'download'
  | 'ok'
  | 'alert'
  | 'package'
  | 'tool'
  | 'external'
  | 'close'
  | 'widget'
  | 'machine'
  | 'home'
  | 'history'
  | 'layout'
  | 'palette'
  | 'search'
  | 'import'
  | 'export'
  | 'snapshot'
  | 'info'
  | 'reset'
  | 'star'
  | 'puzzle'
  | 'celebrate'
  | 'arrow-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'caret-up'
  | 'convert'
  | 'stash'
  | 'clip'
  | 'code'
  | 'link'
  | 'image'
  | 'secret'
  | 'copy'
  | 'list'
  | 'note'
  | 'tag'
  | 'database'
  | 'query'
  // Mail.
  | 'mail'
  | 'inbox'
  | 'send'
  | 'attachment'
  | 'contacts'
  | 'reply'
  | 'client'
  | 'clock'
  // Assistant.
  | 'ai'
  | 'agent'
  | 'bot'
  | 'focus'
  | 'context'
  | 'decision'
  | 'conflict'
  | 'pause'
  | 'commit'
  | 'pull-request'
  | 'issue'

const REGISTRY: Record<IconName, LucideIcon> = {
  'pull-request': GitPullRequest,
  issue: CircleDot,
  workspace: Boxes,
  inbox: Inbox,
  schedule: CalendarClock,
  solution: Layers,
  project: Box,
  folder: Folder,
  command: SquareTerminal,
  service: Zap,
  profile: Layers,
  check: Check,
  add: Plus,
  edit: Pencil,
  pin: Pin,
  delete: Trash2,
  settings: Settings,
  terminal: Terminal,
  view: Eye,
  reveal: FolderOpen,
  run: Play,
  stop: Square,
  restart: RotateCw,
  logs: ScrollText,
  globe: Globe,
  more: MoreHorizontal,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  github: GitBranch,
  example: Sparkles,
  update: RefreshCw,
  spinner: Loader2,
  download: Download,
  ok: CircleCheck,
  alert: CircleAlert,
  package: Package,
  tool: Wrench,
  external: ArrowUpRight,
  close: X,
  widget: AppWindow,
  machine: MonitorCog,
  home: House,
  history: History,
  layout: LayoutGrid,
  palette: Palette,
  search: Search,
  import: Import,
  export: Upload,
  snapshot: Camera,
  info: Info,
  reset: RotateCcw,
  star: Star,
  puzzle: Puzzle,
  celebrate: PartyPopper,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  'arrow-down': ArrowDown,
  'caret-up': ChevronUp,
  convert: ArrowRightLeft,
  stash: Archive,
  clip: Clipboard,
  code: Code,
  link: Link,
  image: Image,
  secret: ShieldAlert,
  copy: Copy,
  list: List,
  note: StickyNote,
  tag: Tag,
  database: Database,
  query: PlayIcon,
  // Mail. `inbox` is not re-declared here — the Inbox rail view already
  // claimed that name, and it is the same tray either way.
  mail: Mail,
  send: Send,
  attachment: Paperclip,
  contacts: Users,
  reply: Reply,
  client: Building2,
  clock: Clock,
  // Assistant. Semantic names, so swapping the glyph is one line.
  ai: Sparkle,
  agent: Bot,
  bot: Bot,
  focus: Crosshair,
  context: Diamond,
  decision: Gavel,
  conflict: TriangleAlert,
  pause: Pause,
  commit: GitCommitHorizontal,
}

export function iconFor(name: string): LucideIcon | undefined {
  return REGISTRY[name as IconName]
}

/**
 * Render an icon by semantic name. `size` is in px (Lucide draws on a 24px
 * grid; 14–16 matches our tree/menu text). Unknown names fall back to the
 * raw string so un-migrated call sites still render something.
 */
export function Icon({
  name,
  size = 14,
  className,
  strokeWidth = 2,
  spin = false,
}: {
  name: IconName
  size?: number
  className?: string
  strokeWidth?: number
  spin?: boolean
}) {
  if (name === 'github') return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .75a11.25 11.25 0 0 0-3.558 21.923c.563.103.768-.244.768-.542 0-.267-.01-.975-.015-1.914-3.13.68-3.79-1.509-3.79-1.509-.512-1.3-1.25-1.646-1.25-1.646-1.023-.7.078-.686.078-.686 1.13.08 1.725 1.16 1.725 1.16 1.005 1.722 2.637 1.225 3.28.937.102-.728.393-1.225.715-1.507-2.499-.284-5.126-1.25-5.126-5.565 0-1.23.44-2.233 1.16-3.02-.116-.285-.503-1.43.11-2.98 0 0 .945-.303 3.094 1.153A10.8 10.8 0 0 1 12 6.175c.956.005 1.919.13 2.819.379 2.148-1.456 3.091-1.153 3.091-1.153.615 1.55.228 2.695.112 2.98.722.787 1.158 1.79 1.158 3.02 0 4.327-2.632 5.278-5.14 5.557.404.35.764 1.043.764 2.1 0 1.516-.014 2.74-.014 3.112 0 .3.203.65.774.54A11.252 11.252 0 0 0 12 .75Z" />
    </svg>
  )
  const C = iconFor(name)
  if (!C) return <span className={className}>{name}</span>
  return (
    <C
      size={size}
      strokeWidth={strokeWidth}
      className={spin ? `animate-spin ${className ?? ''}` : className}
      aria-hidden
    />
  )
}
