// Quick read-only check of the live generated-monster pool size + element spread, via the admin
// HTTP API. Admin token injected by `railway run`, never printed.
//   railway run --service web -- node tools/pool-count.mjs
const TOKEN = process.env.ADMIN_TOKEN;
const BASE = (process.env.BASE || "https://tamersquest.com").replace(/\/$/, "");
if (!TOKEN) { console.error("no ADMIN_TOKEN"); process.exit(1); }
const r = await fetch(BASE + "/api/admin/monsters", { headers: { "x-admin-token": TOKEN } });
const j = await r.json();
const gen = Array.isArray(j.generated) ? j.generated : [];
console.log("pool=" + gen.length);
const byEl = {};
let noAnim = 0;
for (const m of gen) {
  byEl[m.element || "?"] = (byEl[m.element || "?"] || 0) + 1;
  const a = m.animations || [];
  if (!(a.includes("idle") && a.includes("walk") && a.includes("attack"))) noAnim++;
}
console.log("byElement=" + JSON.stringify(byEl));
console.log("missing idle/walk/attack stamp: " + noAnim);
process.exit(0);
