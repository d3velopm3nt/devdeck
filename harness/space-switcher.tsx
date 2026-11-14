import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { SpaceSwitcher } from '../src/shell/SpaceSwitcher'
import type { TreeNode } from '../src/lib/types'

const spaces: TreeNode[] = ['Develtech', 'InnoTrack', 'Life & Personal', 'Home & Garden', 'A very long space name that should stay inside the menu', ...Array.from({ length: 20 }, (_, i) => `Client ${i + 1}`)].map((name, i) => ({ id: i + 1, name, parent_id: null, kind: 'workspace', color: null, path: null, rel_path: '', sort: i, label: null, dir: '' }))
export function Fixture() {
  const [value, setValue] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(true)
  return <main className="flex h-screen bg-app text-ink"><aside className={`border-r border-line p-3 ${expanded ? 'w-[188px]' : 'w-[52px] px-1.5'}`}><SpaceSwitcher spaces={spaces} value={value} onChange={setValue} expanded={expanded} /></aside><section className="p-6"><button onClick={() => setExpanded(!expanded)}>Toggle sidebar</button><p role="status">Selected: {value ?? 'all'}</p><button onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light' }}>Toggle theme</button></section></main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
