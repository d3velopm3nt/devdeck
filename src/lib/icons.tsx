// Central icon registry. Everything visual goes through <Icon name="…" /> so
// the whole app draws from one consistent stroke-icon set (Lucide) instead of
// per-font emoji. Icons inherit `currentColor`, so Tailwind text-* classes
// colour them exactly like the old emoji spans did.
//
// Migration is incremental: if a name isn't a known key, <Icon> renders the
// raw string as a fallback, so panels not yet migrated keep showing their
// emoji until they're switched over.

import {
  Boxes,
  Box,
  Folder,
  FolderOpen,
  SquareTerminal,
  Zap,
  Layers,
  Check,
  Plus,
  Pencil,
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
  Inbox,
  Send,
  Paperclip,
  Users,
  Bot,
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
  | 'project'
  | 'folder'
  | 'command'
  | 'service'
  | 'profile'
  | 'check'
  | 'add'
  | 'edit'
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
  | 'mail'
  | 'inbox'
  | 'send'
  | 'attachment'
  | 'contacts'
  | 'bot'
  | 'reply'
  | 'client'
  | 'clock'

const REGISTRY: Record<IconName, LucideIcon> = {
  workspace: Boxes,
  project: Box,
  folder: Folder,
  command: SquareTerminal,
  service: Zap,
  profile: Layers,
  check: Check,
  add: Plus,
  edit: Pencil,
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
  mail: Mail,
  inbox: Inbox,
  send: Send,
  attachment: Paperclip,
  contacts: Users,
  bot: Bot,
  reply: Reply,
  client: Building2,
  clock: Clock,
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
  name: string
  size?: number
  className?: string
  strokeWidth?: number
  spin?: boolean
}) {
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
