// Routes pty:output events to the xterm instance that owns each
// session. A module-level registry avoids re-rendering React on every
// chunk of terminal output.

type Sink = (data: string) => void

const sinks = new Map<number, Sink>()
const pending = new Map<number, string[]>()

export function registerTerm(id: number, sink: Sink) {
  sinks.set(id, sink)
  const buffered = pending.get(id)
  if (buffered) {
    pending.delete(id)
    for (const chunk of buffered) sink(chunk)
  }
}

export function unregisterTerm(id: number) {
  sinks.delete(id)
}

export function routeOutput(id: number, data: string) {
  const sink = sinks.get(id)
  if (sink) {
    sink(data)
  } else {
    // Terminal panel not mounted yet — buffer briefly.
    const buf = pending.get(id) ?? []
    buf.push(data)
    if (buf.length > 500) buf.shift()
    pending.set(id, buf)
  }
}
