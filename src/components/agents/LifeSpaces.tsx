// Work and Life use the same setup from onboarding and Today.
export function LifeSpaces() {
  return (
    <section className="mb-5" aria-label="Work and Life setup">
      <div className="flex items-center justify-between rounded-xl border border-line bg-panel p-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Spaces</h2>
          <p className="mt-1 text-xs text-muted">Your business and everyday life, with editable spaces, managers and routines.</p>
        </div>
        <button className="btn-primary text-xs" onClick={() => window.dispatchEvent(new CustomEvent('devdeck:setup', { detail: 'spaces' }))}>
          Add a space
        </button>
      </div>
    </section>
  )
}
