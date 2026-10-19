import { useEffect, useRef, useState } from "react";
import {
  UserRound,
  Plus,
  Minus,
  Maximize,
  ArrowLeft,
  Network,
  Layers,
  ArrowRight,
  X,
  Search, LayoutGrid, List, Users, Activity,
} from "lucide-react";
import * as ipc from "../../lib/ipc";
import "./team-builder.css";
import "./workforce.css";

const empty = (): ipc.ReusableTeam => ({
  id: "",
  name: "",
  description: "",
  roles: [
    { name: "lead", worker: "", kind: "manager", reports_to: "", handoffs: [] },
  ],
  revision: 0,
});
const kind = (r: ipc.TeamRole) => r.kind || "worker";
function normalize(team: ipc.ReusableTeam): ipc.ReusableTeam {
  const t = structuredClone(team);
  if (t.roles.some((r) => r.kind)) return t;
  // Legacy flat assignments retain every role name and worker binding.
  t.roles = t.roles.map((r, i) => ({
    ...r,
    kind: i === 0 ? "manager" : "worker",
    reports_to: i === 0 ? "" : t.roles[0].name,
    handoffs: [],
  }));
  return t;
}
function descendants(roles: ipc.TeamRole[], name: string): Set<string> {
  const found = new Set([name]);
  for (let i = 0; i < roles.length; i++)
    for (const r of roles)
      if (r.reports_to && found.has(r.reports_to)) found.add(r.name);
  return found;
}

export function ReusableTeams({
  openedTeam,
  workers,
  onAgents,
  onEdit,
  onCreate,
}: {
  openedTeam?: ipc.ReusableTeam | null;
  workers: ipc.Worker[];
  onAgents: () => void;
  onEdit?: (worker: ipc.Worker) => void;
  onCreate?: (assign: (worker: ipc.Worker) => void) => void;
}) {
  const [teams, setTeams] = useState<ipc.ReusableTeam[]>([]);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('name');
  const [draft, setDraft] = useState<ipc.ReusableTeam | null>(null);
  const [selected, setSelected] = useState("lead");
  const [roleNameDraft, setRoleNameDraft] = useState("lead");
  useEffect(() => setRoleNameDraft(selected), [selected]);
  const [tab, setTab] = useState<"details" | "activity" | "settings">(
    "details",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const fit = () => { if (canvasRef.current && treeRef.current) setZoom(Math.max(.2, Math.min(1, (canvasRef.current.clientWidth - 48) / treeRef.current.scrollWidth))); };
  const [runs, setRuns] = useState<ipc.Run[]>([]);
  const runRequest = useRef(0);
  const [run, setRun] = useState<ipc.Run | null>(null);
  const [source, setSource] = useState("");
  const [readError, setReadError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = () =>
    ipc
      .reusableTeamsList()
      .then(setTeams)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  useEffect(() => {
    void reload();
  }, []);
  useEffect(() => {
    if (!openedTeam) return;
    void reload();
    setDraft(normalize(openedTeam));
    setSelected(openedTeam.roles.find(r => !r.reports_to)?.name || openedTeam.roles[0].name);
    setDirty(false);
    setTab('details');
  }, [openedTeam]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void ipc
        .runsList(0)
        .then((r) => {
          if (active) setRuns(r);
        })
        .catch((e) => {
          if (active) setReadError(String(e));
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);
  const role = draft?.roles.find((r) => r.name === selected);
  const worker = workers.find((w) => w.handle === role?.worker);
  const workerRuns = runs
    .filter((r) => r.worker === role?.worker)
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  useEffect(() => {
    let active = true;
    runRequest.current++;
    setSource("");
    setReadError("");
    setRun(null);
    if (worker?.brief)
      void ipc
        .libraryRead(worker.brief, "brief")
        .then((text) => {
          if (active) setSource(text);
        })
        .catch((e) => {
          if (active) setReadError(String(e));
        });
    return () => {
      active = false;
    };
  }, [worker?.brief, worker?.handle, selected, draft?.id]);
  const change = (next: ipc.ReusableTeam) => {
    setDraft(next);
    setDirty(true);
  };
  const patch = (values: Partial<ipc.TeamRole>) => {
    if (!draft || !role) return;
    const renamed = values.name ?? role.name;
    change({
      ...draft,
      roles: draft.roles.map((r) => ({
        ...(r.name === role.name ? { ...r, ...values } : r),
        reports_to:
          r.name === role.name && values.reports_to !== undefined
            ? values.reports_to
            : r.reports_to && r.reports_to === role.name
              ? renamed
              : r.reports_to,
        handoffs: (r.name === role.name && values.handoffs
          ? values.handoffs
          : r.handoffs || []
        ).map((h) => (h === role.name ? renamed : h)),
      })),
    });
    setSelected(renamed);
  };
  const open = (t: ipc.ReusableTeam) => {
    setDraft(normalize(t));
    setSelected(t.roles[0]?.name || "lead");
    setDirty(false);
    setTab("details");
    setError("");
  };
  const add = (parent: string) => {
    if (!draft || draft.roles.length >= 50) return;
    let n = 1;
    while (draft.roles.some((r) => r.name === `agent-${n}`)) n++;
    const name = `agent-${n}`;
    change({
      ...draft,
      roles: [
        ...draft.roles,
        { name, worker: "", kind: "worker", reports_to: parent, handoffs: [] },
      ],
    });
    setSelected(name);
    setTab("settings");
  };
  const save = async () => {
    if (!draft) return;
    const missing = draft.roles.find(r => !r.worker);
    if (missing) { setSelected(missing.name); setTab('settings'); setError(`Choose or create an agent for ${missing.name} before saving your team.`); return; }
    setBusy(true);
    setError("");
    try {
      const saved = await ipc.reusableTeamSave(draft);
      setDraft(saved);
      setDirty(false);
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const status = (handle: string) => {
    const activity = runs
      .filter((r) => r.worker === handle)
      .sort((a, b) => b.started_at.localeCompare(a.started_at));
    if (activity.some((r) => r.status === "running")) return "Working";
    const last = activity[0];
    if (!last) return "No runs";
    if (["blocked", "failed", "interrupted"].includes(last.status))
      return "Needs attention";
    if (last.status === "done") return "Review";
    return last.status;
  };
  const card = (r: ipc.TeamRole, path = new Set<string>()): React.ReactNode => {
    if (path.has(r.name)) return null;
    const next = new Set(path).add(r.name);
    const children = draft!.roles.filter((c) => c.reports_to === r.name);
    const agent = workers.find((w) => w.handle === r.worker);
    return (
      <li key={r.name}>
        <div
          className={`team-node ${kind(r)} ${selected === r.name ? "selected" : ""}`}
        >
          <button
            className="team-node-main"
            onClick={() => {
              setSelected(r.name);
              setTab("details");
            }}
            aria-label={`Inspect ${r.name}`}
            aria-pressed={selected === r.name}
          >
            <span className="team-avatar">
              <UserRound size={23} />
            </span>
            <span className="team-node-copy">
              <strong>{agent?.name || r.name}</strong>
              <small>{r.name}</small>
              <span className="team-status">
                <i data-status={status(r.worker)} />
                {r.worker ? status(r.worker) : "Choose agent"}
              </span>
            </span>
            <span className="team-role">{kind(r)}</span>
            <span className="team-count">{children.length} direct reports</span>
          </button>
          {kind(r) === "manager" && (
            <button
              className="team-add"
              aria-label={`Add agent under ${r.name}`}
              disabled={busy || draft!.roles.length >= 50}
              onClick={() => add(r.name)}
            >
              <Plus size={16} />
            </button>
          )}
        </div>
        {children.length > 0 && <ul>{children.map((c) => card(c, next))}</ul>}
      </li>
    );
  };
  const working = (t: ipc.ReusableTeam) => runs.some(r => r.status === 'running' && t.roles.some(role => role.worker === r.worker));
  const shown = teams.filter(t => `${t.name} ${t.description}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || (filter === 'active' ? working(t) : t.roles.length === 1))).sort((a, b) => sort === 'size' ? b.roles.length - a.roles.length : a.name.localeCompare(b.name));
  const createTeam = () => { open(empty()); setTab('settings'); };
  if (!draft)
    return (
      <section aria-label="Reusable teams" className="space-y-4">
        <div className="wf-section-heading">
          <div className="flex-1">
            <h2>Your teams <span className="wf-badge">{teams.length}</span></h2>
            <p className="mt-1 text-sm text-muted">
              A focused team for every kind of work. Start with one agent and grow from there.
            </p>
          </div>
          <button
            className="wf-primary"
            disabled={loading}
            onClick={createTeam}
          >
            <Plus size={16} /> Create team
          </button>
        </div>
        <div className="wf-toolbar">
          <label className="wf-search"><Search size={17} /><input aria-label="Search teams" placeholder="Search your teams…" value={search} onChange={e => setSearch(e.target.value)} /></label>
          <div className="wf-segment" aria-label="Filter teams">{[['all','All teams'],['active','Working'],['solo','Solo']].map(([value,label]) => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
          <select className="wf-filter" aria-label="Sort teams" value={sort} onChange={e => setSort(e.target.value)}><option value="name">Name A–Z</option><option value="size">Largest team</option></select>
          <div className="wf-segment wf-view-toggle" aria-label="Team view"><button aria-label="Team card view" aria-pressed={view === 'cards'} title="Cards" onClick={() => setView('cards')}><LayoutGrid size={16} /></button><button aria-label="Team table view" aria-pressed={view === 'table'} title="Table" onClick={() => setView('table')}><List size={16} /></button></div>
        </div>
        {error && (
          <p role="alert" className="text-sm text-err">
            {error}
          </p>
        )}
        {loading ? (
          <p className="text-muted">Loading teams…</p>
        ) : (
          !teams.length && (
            <div className="wf-empty">
              <Network size={36} />
              <h3>Your first team starts with a lead</h3>
              <p>
                Add agents from your library and connect them to the people they
                report to.
              </p>
              <button className="wf-primary" onClick={createTeam}><Plus size={16} />Build your first team</button>
            </div>
          )
        )}
        {teams.length > 0 && !shown.length && <div className="wf-empty"><Search size={28} /><h3>No teams found</h3><p>Try another search or show all teams.</p><button className="wf-secondary" onClick={() => { setSearch(''); setFilter('all') }}>Clear filters</button></div>}
        {view === 'cards' ? <div className="wf-grid">
          {shown.map((t) => (
            <article
              key={t.id}
              className="wf-card"
            >
              <div className="wf-card-top"><span className="wf-tile-icon"><Network size={23} /></span><span className="wf-badge" data-tone={working(t) ? 'active' : undefined}>{working(t) ? <><Activity size={11} />Working</> : 'Idle'}</span></div>
              <h3 className="font-semibold">{t.name}</h3>
              <p>{t.description || 'A team ready for its next assignment.'}</p>
              <div className="wf-avatars">{t.roles.slice(0,5).map(r => <span key={r.name} title={workers.find(w => w.handle === r.worker)?.name || r.name}>{(workers.find(w => w.handle === r.worker)?.name || r.name).slice(0,2).toUpperCase()}</span>)}{t.roles.length > 5 && <span>+{t.roles.length - 5}</span>}</div>
              <div className="wf-card-footer"><Users size={13} /><span className="wf-muted">{t.roles.length} {t.roles.length === 1 ? 'member' : 'members'}</span><button className="wf-link" onClick={() => open(t)}>
                Open team <ArrowRight size={14} />
              </button></div>
            </article>
          ))}
        </div> : shown.length > 0 && <div className="wf-table-wrap"><table className="wf-table"><thead><tr><th>Team</th><th>Members</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{shown.map(t => <tr key={t.id}><td><strong>{t.name}</strong><p>{t.description}</p></td><td>{t.roles.length}</td><td><span className="wf-badge" data-tone={working(t) ? 'active' : undefined}>{working(t) ? 'Working' : 'Idle'}</span></td><td><button className="wf-link" onClick={() => open(t)}>Open team <ArrowRight size={14} /></button></td></tr>)}</tbody></table></div>}
      </section>
    );
  const forbiddenParents = role
    ? descendants(draft.roles, role.name)
    : new Set<string>();
  const prompt = worker
    ? [
        source && `TEMPLATE · ${worker.brief}\n${source}`,
        `AGENT INSTRUCTIONS\n${worker.body || worker.what}`,
        `TEAM ROLE\n${role?.name} (${role && kind(role)}).\n${role?.instructions || ""}\nReports to: ${role?.reports_to || "Dev"}.\nCoordinates: ${
          draft.roles
            .filter((r) => r.reports_to === role?.name)
            .map((r) => r.name)
            .join(", ") || "No direct reports"
        }.\nHandoff targets: ${role?.handoffs?.join(", ") || "None configured"}.`,
        `AVAILABLE SKILLS\n${worker.skills.join(", ") || "No skills assigned"}`,
        "TASK CONTEXT\nAdded when a workflow starts this agent. Reporting and handoff requests go through the workflow coordinator; team relationships do not grant extra tools or permissions.",
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";
  return (
    <section aria-label="Team builder" className="team-builder">
      <header className="team-heading">
        <button
          className="btn-ghost"
          aria-label="Back to teams"
          disabled={busy}
          onClick={() => {
            if (!dirty || window.confirm("Discard unsaved team changes?"))
              setDraft(null);
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h2>{draft.name || "New team"}</h2>
          <p>
            Reusable team · {draft.roles.length} agents
            {dirty ? " · Unsaved changes" : ""}
          </p>
        </div>
        <button
          className="btn-ghost"
          disabled={busy || draft.roles.length >= 50}
          onClick={() =>
            add(
              role && kind(role) === "manager"
                ? role.name
                : draft.roles.find((r) => !r.reports_to)?.name || "",
            )
          }
        >
          <Plus size={16} /> Add agent
        </button>
        <button
          className="btn-primary"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save team"}
        </button>
      </header>
      {error && (
        <p role="alert" className="m-3 text-sm text-err">
          {error}
        </p>
      )}
      <details className="team-info-panel">
        <summary>Team details <span>{draft.name || 'New team'}</span></summary>
        <fieldset disabled={busy} className="team-info-fields team-fields">
                <label>
                  Team name
                  <input
                    aria-label="Team name"
                    className="input"
                    value={draft.name}
                    onChange={(e) => change({ ...draft, name: e.target.value })}
                  />
                </label>
                <label>
                  Team ID
                  <input
                    aria-label="Team ID"
                    className="input"
                    disabled={draft.revision > 0}
                    value={draft.id}
                    placeholder="development"
                    onChange={(e) => change({ ...draft, id: e.target.value })}
                  />
                </label>
                <label>
                  Purpose
                  <input
                    className="input"
                    value={draft.description}
                    onChange={(e) =>
                      change({ ...draft, description: e.target.value })
                    }
                  />
                </label>
        </fieldset>
      </details>
      <div className="team-layout">
        <div className="team-canvas-wrap">
          <div className="team-canvas-label">
            Agent activity across all runs · refreshes every 5s
          </div>
          <div className="team-canvas" ref={canvasRef}>
            <div className="team-tree" ref={treeRef} style={{ zoom }}>
              <ul>
                {draft.roles.filter((r) => !r.reports_to).map((r) => card(r))}
              </ul>
            </div>
          </div>
          <footer className="team-canvas-tools">
            <div>
              <button
                aria-label="Zoom out"
                onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}
              >
                <Minus size={15} />
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button
                aria-label="Zoom in"
                onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
              >
                <Plus size={15} />
              </button>
              <button aria-label="Reset zoom" onClick={() => setZoom(1)}>
                <Maximize size={15} />
              </button>
              <button onClick={fit}>Fit</button>
            </div>
            <div className="team-legend">
              <span className="legend-manager">Manager</span>
              <span className="legend-specialist">Specialist</span>
              <span className="legend-worker">Worker</span>
            </div>
          </footer>
        </div>
        {role && (
          <aside className="team-inspector" aria-label="Agent details">
            <div className={`team-person ${kind(role)}`}>
              <span className="team-avatar">
                <UserRound size={25} />
              </span>
              <div>
                <h3>{worker?.name || role.name}</h3>
                <span className="team-role">{kind(role)}</span>
                <p>Reports to {role.reports_to || "Dev"}</p>
              </div>
            </div>
            <nav aria-label="Agent detail tabs">
              {(["details", "activity", "settings"] as const).map((t) => (
                <button
                  key={t}
                  aria-pressed={tab === t}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </nav>
            {readError && (
              <p role="alert" className="text-sm text-err">
                {readError}
              </p>
            )}
            {tab === "details" && (
              <div className="team-detail-content">
                <div className="team-section-title">
                  <h4>Starting prompt</h4>
                  <button
                    className="btn-ghost"
                    onClick={() => setTab("settings")}
                  >
                    Edit
                  </button>
                </div>
                <p className="text-xs text-muted mb-3">
                  Configuration preview. The exact runtime instructions are
                  captured when a run starts.
                </p>
                <pre className="team-prompt">
                  {prompt ||
                    "Choose a configured agent in Settings to see its instructions and skills."}
                </pre>
                <div className="team-source-tags">
                  <span>Template</span>
                  <span>Team role</span>
                  <span>Task context at launch</span>
                </div>
                <div className="team-section-title">
                  <h4>Assigned skills</h4>
                  {worker && onEdit && (
                    <button
                      className="btn-ghost"
                      onClick={() => onEdit(worker)}
                    >
                      Edit agent
                    </button>
                  )}
                </div>
                <div className="team-skill-list">
                  {worker?.skills.map((s) => (
                    <span key={s}>
                      <Layers size={14} />
                      {s}
                    </span>
                  ))}
                  {!worker?.skills.length && (
                    <p className="text-sm text-muted">No skills assigned.</p>
                  )}
                </div>
                <h4>Communication</h4>
                <div className="team-communication">
                  <p>
                    Reports to <strong>{role.reports_to || "Dev"}</strong>
                  </p>
                  <p>
                    Handoff to{" "}
                    <strong>
                      {role.handoffs?.join(", ") || "None configured"}
                    </strong>
                  </p>
                </div>
                <p className="text-xs text-muted">
                  Configured relationships. Direct agent messaging is not
                  enabled by these links.
                </p>
                <button
                  className="btn-ghost"
                  onClick={() => setTab("activity")}
                >
                  View run activity <ArrowRight size={14} />
                </button>
              </div>
            )}
            {tab === "settings" && (
              <fieldset
                disabled={busy}
                className="team-detail-content team-fields"
              >
                <div className="team-member-save"><h4>Member settings</h4><button className="btn-primary" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Saving...' : 'Save team changes'}</button></div>
                <p className="text-xs text-muted">Role changes are saved with the team. Edit the agent profile below to change its model, skills, or instructions.</p>
                <h4>Agent role</h4>
                <label>
                  Role ID
                  <input
                    aria-label="Role ID"
                    className="input"
                    value={roleNameDraft}
                    disabled={teams
                      .find((t) => t.id === draft.id)
                      ?.roles.some((r) => r.name === role.name)}
                    onChange={e => setRoleNameDraft(e.target.value)}
                    onBlur={() => {
                      if (!/^[a-z0-9_-]{1,80}$/.test(roleNameDraft) || draft.roles.some(r => r.name === roleNameDraft && r !== role)) {
                        setRoleNameDraft(role.name);
                        setError('Role IDs must be unique lowercase letters, numbers, hyphens or underscores.');
                      } else if (roleNameDraft !== role.name) {
                        patch({name:roleNameDraft}); setError('');
                      }
                    }}
                  />
                </label>
                <p className="text-xs text-muted">
                  Use lowercase letters, numbers, hyphens or underscores. Saved
                  role IDs stay stable for workflow references.
                </p>
                <label>
                  Agent type
                  <select aria-label="Agent type"
                    className="input"
                    value={kind(role)}
                    disabled={
                      !role.reports_to ||
                      draft.roles.some((r) => r.reports_to === role.name)
                    }
                    onChange={(e) =>
                      patch({ kind: e.target.value as ipc.TeamRole["kind"] })
                    }
                  >
                    <option value="manager">Manager</option>
                    <option value="specialist">Specialist</option>
                    <option value="worker">Worker</option>
                  </select>
                </label>
                {(!role.reports_to || draft.roles.some(r => r.reports_to === role.name)) && <p className="text-xs text-muted">{!role.reports_to ? 'The team lead must remain a manager.' : 'Reassign this manager’s direct reports before changing their type.'}</p>}
                <p className="text-xs text-muted">
                  Choose a configured workflow agent. Manager roles coordinate
                  through Dev; this does not start a separate manager session.
                </p>
                <label>
                  Saved agent
                  <select
                    aria-label="Saved agent"
                    className="input"
                    value={role.worker}
                    onChange={(e) => patch({ worker: e.target.value })}
                  >
                    <option value="">Choose agent</option>
                    {role.worker && !worker && (
                      <option value={role.worker}>
                        Missing: {role.worker}
                      </option>
                    )}
                    {workers.map((w) => (
                      <option key={w.handle} value={w.handle}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="wf-secondary" onClick={() => {
                  if (!onCreate) { onAgents(); return; }
                  const roleName = role.name;
                  onCreate(saved => { setDraft(current => current ? { ...current, roles: current.roles.map(r => r.name === roleName ? { ...r, worker: saved.handle } : r) } : current); setDirty(true); setError(''); });
                }}><Plus size={14} />Create member from library</button>
                {worker && onEdit && <button className="wf-link" onClick={() => onEdit(worker)}>Edit model, skills & instructions <ArrowRight size={13} /></button>}
                <label>
                  Reports to
                  <select aria-label="Reports to"
                    className="input"
                    disabled={!role.reports_to}
                    value={role.reports_to || ""}
                    onChange={(e) => patch({ reports_to: e.target.value })}
                  >
                    {!role.reports_to && (
                      <option value="">Dev · team lead</option>
                    )}
                    {draft.roles
                      .filter(
                        (r) =>
                          kind(r) === "manager" &&
                          !forbiddenParents.has(r.name),
                      )
                      .map((r) => (
                        <option key={r.name} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Team role instructions
                  <textarea
                    className="input"
                    rows={4}
                    value={role.instructions || ""}
                    onChange={(e) => patch({ instructions: e.target.value })}
                  />
                </label>
                <fieldset>
                  <legend className="mb-2 text-sm">Handoff targets</legend>
                  {draft.roles
                    .filter((r) => r.name !== role.name)
                    .map((r) => (
                      <label key={r.name} className="team-checkbox">
                        <input
                          type="checkbox"
                          checked={role.handoffs?.includes(r.name) || false}
                          onChange={(e) =>
                            patch({
                              handoffs: e.target.checked
                                ? [...(role.handoffs || []), r.name]
                                : role.handoffs?.filter((h) => h !== r.name),
                            })
                          }
                        />
                        {r.name}
                      </label>
                    ))}
                </fieldset>
                <button
                  className="btn-ghost text-err"
                  disabled={
                    !role.reports_to ||
                    draft.roles.some((r) => r.reports_to === role.name)
                  }
                  onClick={() => {
                    change({
                      ...draft,
                      roles: draft.roles
                        .filter((r) => r.name !== role.name)
                        .map((r) => ({
                          ...r,
                          handoffs: r.handoffs?.filter((h) => h !== role.name),
                        })),
                    });
                    setSelected(draft.roles.find((r) => !r.reports_to)!.name);
                  }}
                >
                  <X size={14} /> Remove role
                </button>
                <p className="text-xs text-muted">
                  Move direct reports before removing a manager. Keep workflow
                  role references up to date.
                </p>
              </fieldset>
            )}
            {tab === "activity" && (
              <div className="team-detail-content">
                <h4>Agent runs</h4>
                <p className="text-xs text-muted">
                  All runs for this configured agent, including other teams.
                </p>
                {!workerRuns.length && (
                  <p className="text-sm text-muted">No runs recorded yet.</p>
                )}
                {workerRuns.map((r) => (
                  <button
                    key={r.id}
                    className="team-run"
                    onClick={() => {
                      setRun(null);
                      const request = ++runRequest.current;
                      void ipc
                        .runGet(r.id)
                        .then((value) => {
                          if (request === runRequest.current) setRun(value);
                        })
                        .catch((e) => {
                          if (request === runRequest.current)
                            setReadError(String(e));
                        });
                    }}
                  >
                    <strong>{r.title}</strong>
                    <span>
                      {r.status} · {new Date(r.started_at).toLocaleString()}
                    </span>
                  </button>
                ))}
                {run && (
                  <>
                    <h4>Starting instructions · saved at launch</h4>
                    <pre className="team-prompt">
                      {run.starting_prompt ||
                        "This older run has no stored starting prompt."}
                    </pre>
                    <h4>Recorded activity</h4>
                    {run.steps.map((s, i) => (
                      <p className="team-event" key={i}>
                        <small>
                          {s.at} · {s.kind}
                        </small>
                        {s.text}
                      </p>
                    ))}
                  </>
                )}
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}
