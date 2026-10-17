import React from "react";
import { createRoot } from "react-dom/client";
import { SEED } from "./seed";
import { AgentDirectory } from "../src/components/agents/AgentDirectory";
import type { ReusableTeam, Worker } from "../src/lib/ipc";
import "../src/index.css";
const f = SEED as Record<string, (args?: Record<string, unknown>) => unknown>;
const names = [
  "Lead manager",
  "Engineering manager",
  "Research specialist",
  "QA specialist",
  "Frontend specialist",
  "Backend worker",
  "Test worker",
];
const workers: Worker[] = names.map((name, i) => ({
  handle: `agent-${i}`,
  name,
  category: "worker",
  profile: "Custom",
  what: "Deliver agreed work",
  body: "Use the assigned skills. Return evidence and report blockers.",
  skills: i === 4 ? ["react", "accessibility"] : [],
  brief: "",
  kit: "",
  runner: "claude-code",
  model: "sonnet",
  writes: "branch",
  minutes: 20,
  usd: 2,
  spaces: [],
  unattended: false,
  allow: [],
  allow_until: "",
  created_at: "",
}));
const fixture: ReusableTeam = {
  id: "development",
  name: "Development team",
  description: "Build and review product changes",
  revision: 1,
  roles: [
    { name: "lead", worker: "agent-0", kind: "manager" },
    {
      name: "engineering",
      worker: "agent-1",
      kind: "manager",
      reports_to: "lead",
    },
    {
      name: "research",
      worker: "agent-2",
      kind: "specialist",
      reports_to: "lead",
    },
    { name: "qa", worker: "agent-3", kind: "specialist", reports_to: "lead" },
    {
      name: "frontend",
      worker: "agent-4",
      kind: "specialist",
      reports_to: "engineering",
      handoffs: ["qa"],
    },
    {
      name: "backend",
      worker: "agent-5",
      kind: "worker",
      reports_to: "engineering",
    },
    {
      name: "test",
      worker: "agent-6",
      kind: "worker",
      reports_to: "engineering",
    },
  ],
};
let teams = [fixture, {...fixture,id:'research',name:'Research studio',description:'Turn questions into useful, sourced answers.',roles:[fixture.roles[0]]}];
f.workers_list = () => workers;
f.worker_save = args => { const w = {...args?.worker as Worker,handle: 'created-agent'}; workers.push(w); return w; };
f.library_list = () => [
  {id:'researcher',kind:'brief',name:'Research partner',what:'Find reliable sources, compare evidence, and deliver clear answers.',repo:'personal',commit:'',licence:''},
  {id:'developer',kind:'brief',name:'Product engineer',what:'Build thoughtful interfaces and well-tested product features.',repo:'community',commit:'',licence:''},
  {id:'writer',kind:'brief',name:'Editorial specialist',what:'Turn complex ideas into clear, useful writing.',repo:'personal',commit:'',licence:''},
  {id:'review',kind:'skill',name:'Code review',what:'Review changes for correctness, clarity, and maintainability.',repo:'personal',commit:'',licence:''},
];
f.library_read = () => 'Follow the task and return reviewable results.';
f.reusable_teams_list = () => structuredClone(teams);
f.reusable_team_save = (args) => {
  const t = structuredClone(args?.team) as ReusableTeam;
  if (!t.id || !t.name || t.roles.some((r) => !r.worker))
    throw new Error("Name the team and choose an agent for every role.");
  t.revision++;
  teams = teams.filter((x) => x.id !== t.id).concat(t);
  return t;
};
f.runs_list = () => [
  {
    id: "run-front",
    worker: "agent-4",
    title: "Build settings panel",
    status: "running",
    started_at: "2026-10-15T10:00:00Z",
    steps: [],
  },
];
f.run_get = () => ({
  id: "run-front",
  title: "Build settings panel",
  starting_prompt:
    "EXACT SAVED PROMPT: implement settings with React. Report to engineering.",
  steps: [
    { at: "2026-10-15T10:00:00Z", kind: "note", text: "Started settings work" },
  ],
});
(window as unknown as { savedTeams: () => ReusableTeam[] }).savedTeams = () =>
  structuredClone(teams);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <main style={{height:"100vh"}}>
      <AgentDirectory />
    </main>
  </React.StrictMode>,
);

f.library_look = () => ({ repo: 'sample/tool', commit: 'test-commit', licence: 'MIT', branch: 'main', items: [], kits: [], note: 'No importable definitions in this fixture.' });

f.aiw_new_conversation = () => ({ id: 'repo-review-fixture' });
f.aiw_send_message = () => ({ reply: 'Fixture file explanation', appended: [], delegated: [], turns: 1 });
const discoveryItem = { id: 'repo-fixture', name: 'Fixture repository', author: 'sample', source: 'https://github.com/sample/tool', summary: 'Shared repository page fixture', kind: 'tool', licence: 'permissive', version: '', command: '', stars: 42 };
f.community_index = () => ['github', 'trending-week', 'trending-month', 'year'].map(source => ({ source, items: [discoveryItem], fetched_at: Date.now(), error: null, ok: true, note: "", sorts: [] }));
f.community_arrange = () => [discoveryItem];
