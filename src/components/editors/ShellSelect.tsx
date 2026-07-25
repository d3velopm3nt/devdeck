// Dropdown to choose which shell/interpreter a command or service runs
// under. Options come from the shells detected on this machine; the stored
// value is the shell's path ('' = the default). If the saved value isn't a
// detected shell (a custom path), it's still shown as the selected option.

import { useApp } from '../../store'

export function ShellSelect({
  value,
  onChange,
  defaultLabel = 'Default',
}: {
  value: string
  onChange: (v: string) => void
  defaultLabel?: string
}) {
  const shells = useApp((s) => s.shells)
  const known = value === '' || shells.some((s) => s.command === value)
  return (
    <select className="input w-full" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{defaultLabel}</option>
      {shells.map((s) => (
        <option key={s.command} value={s.command}>
          {s.name}
        </option>
      ))}
      {!known && <option value={value}>Custom: {value}</option>}
    </select>
  )
}
