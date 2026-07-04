// Local Jira dashboard for the Tamer's Quest TQ project.
//   node tools/jira-dashboard.mjs   →  open http://localhost:7777
// Dependency-free (Node 18+ for global fetch). Reads JIRA_TOKEN from .env and proxies
// the Jira Cloud REST API server-side (so the token never reaches the browser). The page
// has a Refresh button that re-pulls live and recomputes every panel.
//
// Tailored to this project's setup: the Assigned Agent (cf10041) + Approved (cf10042)
// custom fields, the Human Task / Blocker issue types, the approval gate, and the
// many-concurrent-agents workflow (incl. a "stranded" health check: In Progress, no agent).

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const EMAIL = "dominik.burger00@gmail.com";
const BASE = "https://dmbu.atlassian.net";
const PROJECT = "TQ";
const PORT = Number(process.env.PORT) || 7777;
const F_AGENT = "customfield_10041"; // Assigned Agent
const F_APPROVED = "customfield_10042"; // Approved (checkbox)

function jiraToken() {
  const envPath = join(dirname(dirname(fileURLToPath(import.meta.url))), ".env");
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    if (line.startsWith("JIRA_TOKEN=")) return line.slice("JIRA_TOKEN=".length).trim();
  }
  throw new Error("JIRA_TOKEN not found in .env");
}
const AUTH = "Basic " + Buffer.from(`${EMAIL}:${jiraToken()}`).toString("base64");

// Pull every TQ issue (paginated) with just the fields the panels need.
async function fetchIssues() {
  const fields = ["summary", "status", "issuetype", "parent", "updated", "statuscategorychangedate", F_AGENT, F_APPROVED];
  const out = [];
  let nextPageToken;
  do {
    const u = new URL(BASE + "/rest/api/3/search/jql");
    u.searchParams.set("jql", `project = ${PROJECT} ORDER BY updated DESC`);
    u.searchParams.set("fields", fields.join(","));
    u.searchParams.set("maxResults", "100");
    if (nextPageToken) u.searchParams.set("nextPageToken", nextPageToken);
    const r = await fetch(u, { headers: { Authorization: AUTH, Accept: "application/json" } });
    if (!r.ok) throw new Error(`Jira ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    for (const i of j.issues || []) {
      const f = i.fields || {};
      const approvedRaw = f[F_APPROVED];
      out.push({
        key: i.key,
        summary: f.summary || "",
        status: f.status?.name || "?",
        category: f.status?.statusCategory?.name || "?", // To Do | In Progress | Done
        type: f.issuetype?.name || "?",
        agent: f[F_AGENT] || null,
        approved: Array.isArray(approvedRaw) ? approvedRaw.length > 0 : !!approvedRaw,
        parent: f.parent ? { key: f.parent.key, summary: f.parent.fields?.summary || "" } : null,
        updated: f.updated || null,
        changedAt: f.statuscategorychangedate || null,
      });
    }
    nextPageToken = j.isLast ? undefined : j.nextPageToken;
  } while (nextPageToken && out.length < 1000);
  return out;
}

const HTML = /* html */ `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>TQ — Dev Dashboard</title>
<style>
  :root{--bg:#0C0A14;--panel:#16131F;--panel2:#221D31;--line:#322A47;--text:#ECF4EF;--mut:#8A8AA8;
        --ember:#F2683C;--amber:#E0A85C;--teal:#46E6C6;--violet:#9B7FE6;--ok:#4BD18C;--warn:#E0A85C;--bad:#E0524A;}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,Segoe UI,sans-serif}
  header{display:flex;align-items:center;gap:16px;padding:18px 24px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:5}
  h1{font-size:20px;margin:0;color:var(--teal)} .sub{color:var(--mut);font-size:13px}
  button{background:var(--ember);color:#1a0e08;border:0;border-radius:8px;padding:9px 18px;font-weight:700;font-size:14px;cursor:pointer}
  button:hover{filter:brightness(1.08)} button:disabled{opacity:.5;cursor:default}
  .wrap{padding:22px 24px;max-width:1280px;margin:0 auto}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:26px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
  .card .n{font-size:30px;font-weight:700} .card .l{color:var(--mut);font-size:13px;text-transform:uppercase;letter-spacing:.5px}
  .card.warn .n{color:var(--warn)} .card.bad .n{color:var(--bad)} .card.ok .n{color:var(--ok)}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px}
  .sec{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
  .sec h2{font-size:14px;text-transform:uppercase;letter-spacing:.6px;color:var(--violet);margin:0 0 12px}
  .sec.alert h2{color:var(--warn)}
  table{width:100%;border-collapse:collapse;font-size:14px} td,th{text-align:left;padding:5px 6px;border-bottom:1px solid var(--line);vertical-align:top}
  th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase}
  tr:last-child td{border-bottom:0}
  .key{color:var(--teal);font-weight:600;white-space:nowrap;text-decoration:none} .key:hover{text-decoration:underline}
  .pill{display:inline-block;padding:1px 8px;border-radius:20px;font-size:12px;background:var(--panel2);color:var(--mut)}
  .pill.todo{color:#9fb4d0} .pill.prog{color:var(--amber)} .pill.done{color:var(--ok)}
  .bar{height:8px;background:var(--panel2);border-radius:6px;overflow:hidden;margin-top:4px}
  .bar>i{display:block;height:100%;background:var(--ok)}
  .mut{color:var(--mut)} .empty{color:var(--mut);font-style:italic;font-size:13px}
  .err{background:#2a1414;border:1px solid var(--bad);color:#ffd9d5;padding:12px 16px;border-radius:10px;margin-bottom:18px}
</style></head>
<body>
<header>
  <h1>TQ — Dev Dashboard</h1>
  <div class="sub" id="meta">—</div>
  <div style="flex:1"></div>
  <label class="sub"><input type="checkbox" id="auto"/> auto 60s</label>
  <button id="refresh">↻ Refresh</button>
</header>
<div class="wrap" id="root"><p class="mut">Loading…</p></div>

<script>
const $=(s)=>document.querySelector(s);
const el=(t,c,h)=>{const e=document.createElement(t);if(c)e.className=c;if(h!=null)e.innerHTML=h;return e;};
const esc=(s)=>String(s).replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
const catClass=(c)=>c==='Done'?'done':c==='In Progress'?'prog':'todo';
const link=(k)=>'<a class="key" target="_blank" href="https://dmbu.atlassian.net/browse/'+k+'">'+k+'</a>';
const ago=(iso)=>{if(!iso)return'';const d=(Date.now()-new Date(iso))/86400000;return d<1?'today':Math.floor(d)+'d ago';};

function rowsTable(items, cols){
  if(!items.length) return el('p','empty','Nothing here — good.');
  const t=el('table');const head=el('tr');cols.forEach(c=>head.appendChild(el('th',null,c.h)));t.appendChild(head);
  items.forEach(it=>{const tr=el('tr');cols.forEach(c=>tr.appendChild(el('td',null,c.f(it))));t.appendChild(tr);});
  return t;
}
function sec(title,node,alert){const s=el('div','sec'+(alert?' alert':''));s.appendChild(el('h2',null,title));s.appendChild(node);return s;}

function render(data){
  const root=$('#root');root.innerHTML='';
  const I=data.issues;
  const open=(i)=>i.category!=='Done';
  const by=(f)=>{const m={};I.forEach(i=>{const k=f(i)??'—';(m[k]=m[k]||[]).push(i)});return m;};
  const count=(arr)=>arr.length;

  const todo=I.filter(i=>i.category==='To Do');
  const prog=I.filter(i=>i.category==='In Progress');
  const done=I.filter(i=>i.category==='Done');
  const needApproval=I.filter(i=>open(i)&&['Story','Epic','Feature'].includes(i.type)&&!i.approved);
  const blockers=I.filter(i=>open(i)&&i.type==='Blocker');
  const humanTasks=I.filter(i=>open(i)&&i.type==='Human Task');
  const stranded=prog.filter(i=>!i.agent);
  const recentDone=done.filter(i=>i.changedAt&&(Date.now()-new Date(i.changedAt))<7*86400000)
                       .sort((a,b)=>new Date(b.changedAt)-new Date(a.changedAt));

  // stat cards
  const cards=el('div','cards');
  const card=(n,l,cls)=>{const c=el('div','card'+(cls?' '+cls:''));c.appendChild(el('div','n',n));c.appendChild(el('div','l',l));return c;};
  cards.appendChild(card(I.length,'Total'));
  cards.appendChild(card(todo.length,'To Do'));
  cards.appendChild(card(prog.length,'In Progress','ok'));
  cards.appendChild(card(done.length,'Done','ok'));
  cards.appendChild(card(needApproval.length,'Needs approval',needApproval.length?'warn':''));
  cards.appendChild(card(blockers.length,'Open blockers',blockers.length?'warn':''));
  cards.appendChild(card(stranded.length,'Stranded',stranded.length?'bad':''));
  root.appendChild(cards);

  const grid=el('div','grid');

  // Needs your action (approval + blockers + human tasks + stranded)
  grid.appendChild(sec('⚠ Needs your approval', rowsTable(needApproval,[
    {h:'Key',f:i=>link(i.key)},{h:'Type',f:i=>'<span class="pill">'+esc(i.type)+'</span>'},{h:'Summary',f:i=>esc(i.summary)}]),true));
  grid.appendChild(sec('⚠ Open blockers', rowsTable(blockers,[
    {h:'Key',f:i=>link(i.key)},{h:'Status',f:i=>'<span class="pill '+catClass(i.category)+'">'+esc(i.status)+'</span>'},{h:'Summary',f:i=>esc(i.summary)}]),true));
  grid.appendChild(sec('Open human tasks', rowsTable(humanTasks,[
    {h:'Key',f:i=>link(i.key)},{h:'Summary',f:i=>esc(i.summary)}])));
  grid.appendChild(sec('⚠ Stranded (In Progress, no agent)', rowsTable(stranded,[
    {h:'Key',f:i=>link(i.key)},{h:'Summary',f:i=>esc(i.summary)}]),stranded.length>0));

  // In progress by agent
  const agents=by(i=>i.agent);
  const agentRows=Object.keys(agents).filter(k=>agents[k].some(i=>i.category==='In Progress'))
    .map(k=>({agent:k,items:agents[k].filter(i=>i.category==='In Progress')}));
  const at=el('div');
  if(!agentRows.length) at.appendChild(el('p','empty','No active work right now.'));
  else agentRows.forEach(r=>{
    at.appendChild(el('div',null,'<strong>'+esc(r.agent)+'</strong> <span class="mut">('+r.items.length+')</span>'));
    const ul=el('div','mut');ul.style.margin='2px 0 10px';ul.innerHTML=r.items.map(i=>link(i.key)+' '+esc(i.summary)).join('<br>');
    at.appendChild(ul);
  });
  grid.appendChild(sec('In progress by agent', at));

  // By epic / parent (progress)
  const parents=by(i=>i.parent?i.parent.key+' '+i.parent.summary:null);
  delete parents['—'];
  const pNode=el('div');
  Object.keys(parents).sort().forEach(k=>{
    const arr=parents[k];const d=arr.filter(i=>i.category==='Done').length;const pct=Math.round(100*d/arr.length);
    pNode.appendChild(el('div',null,'<span class="mut">'+esc(k)+'</span> &nbsp;<span class="mut">'+d+'/'+arr.length+'</span>'));
    const b=el('div','bar');b.appendChild(el('i'));b.firstChild.style.width=pct+'%';pNode.appendChild(b);
    pNode.appendChild(el('div',null,'<div style="height:10px"></div>'));
  });
  if(!pNode.childNodes.length)pNode.appendChild(el('p','empty','No parented issues.'));
  grid.appendChild(sec('Progress by epic', pNode));

  // By type
  const types=by(i=>i.type);
  grid.appendChild(sec('By type', rowsTable(Object.keys(types).sort().map(k=>({k,v:types[k]})),[
    {h:'Type',f:r=>esc(r.k)},
    {h:'Open',f:r=>r.v.filter(open).length},
    {h:'Done',f:r=>r.v.filter(i=>i.category==='Done').length},
    {h:'Total',f:r=>r.v.length}])));

  // Recently done
  grid.appendChild(sec('Recently done (7d)', rowsTable(recentDone,[
    {h:'Key',f:i=>link(i.key)},{h:'When',f:i=>'<span class="mut">'+ago(i.changedAt)+'</span>'},{h:'Summary',f:i=>esc(i.summary)}])));

  root.appendChild(grid);
}

async function refresh(){
  const btn=$('#refresh');btn.disabled=true;btn.textContent='↻ …';
  try{
    const r=await fetch('/api/data');const j=await r.json();
    if(j.error){$('#root').innerHTML='<div class="err">'+esc(j.error)+'</div>';}
    else{render(j);$('#meta').textContent=j.issues.length+' issues · updated '+new Date(j.fetchedAt).toLocaleTimeString();}
  }catch(e){$('#root').innerHTML='<div class="err">'+esc(e.message)+'</div>';}
  btn.disabled=false;btn.textContent='↻ Refresh';
}
$('#refresh').onclick=refresh;
let timer=null;
$('#auto').onchange=(e)=>{clearInterval(timer);if(e.target.checked)timer=setInterval(refresh,60000);};
refresh();
</script>
</body></html>`;

const server = createServer(async (req, res) => {
  if (req.url === "/" || req.url.startsWith("/index")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(HTML);
  }
  if (req.url.startsWith("/api/data")) {
    try {
      const issues = await fetchIssues();
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(JSON.stringify({ issues, fetchedAt: Date.now() }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  }
  res.writeHead(404); res.end("not found");
});
server.listen(PORT, () => console.log(`TQ dashboard → http://localhost:${PORT}`));
