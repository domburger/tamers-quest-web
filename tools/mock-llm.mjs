// Mock OpenAI judge on :8099; run server with OPENAI_API_KEY=test OPENAI_BASE_URL=http://localhost:8099/v1 (knobs: MOCK_CATCH, MOCK_DMG, MOCK_ENEMY_DMG, MOCK_DELAY_MS).
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT) || 8099;
const CATCH = process.env.MOCK_CATCH !== "0";
const DMG = Number(process.env.MOCK_DMG) || 45, EDMG = Number(process.env.MOCK_ENEMY_DMG) || 12;
const DELAY = Number(process.env.MOCK_DELAY_MS ?? 300);
let calls = 0;

function answer(system, user) {
  const u = String(user || ""), s = String(system || "");
  if (/binding|spirit chain|caught/i.test(u) && !/WHO ATTACKS WHOM/.test(u)) {
    return { caught: CATCH ? 1 : 0, text: CATCH ? "The chain binds tight — caught!" : "It shrugs the chain off and breaks free!" };
  }
  if (/WHO ATTACKS WHOM/.test(u) || /playerEdits|enemyEdits/.test(s)) {
    const enemyActs = /the ENEMY's monster \([^)]*\) attacks the PLAYER/i.test(u);
    return enemyActs
      ? { playerEdits: { currentHealth: -EDMG }, enemyEdits: { currentEnergy: -5 }, display: "The wild monster lashes out — a glancing hit.", special: {} }
      : { playerEdits: { currentEnergy: -6 }, enemyEdits: { currentHealth: -DMG }, display: "A clean strike lands hard!", special: {} };
  }
  if (/Player:.*Enemy:/s.test(u)) {
    return { narrative: "The monsters trade blows." };
  }
  return { ok: true, text: "mock" };
}

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.method === "GET" && /\/models$/.test(req.url)) return send(200, { data: [{ id: "mock-judge" }, { id: "gpt-5.4-mini" }] });
    if (!/chat\/completions$/.test(req.url)) return send(404, { error: "not found" });
    let msgs = [];
    try { msgs = JSON.parse(body).messages || []; } catch { return send(400, { error: "bad json" }); }
    const system = msgs.find((m) => m.role === "system")?.content, user = msgs.filter((m) => m.role !== "system").map((m) => m.content).join("\n");
    const out = answer(system, user);
    calls++;
    console.log(`[mock-llm] #${calls} → ${JSON.stringify(out).slice(0, 90)}`);
    setTimeout(() => send(200, { choices: [{ message: { content: JSON.stringify(out) } }], usage: { prompt_tokens: 400, completion_tokens: 40 } }), DELAY);
  });
}).listen(PORT, () => console.log(`[mock-llm] OpenAI-compatible mock on http://localhost:${PORT}/v1 (catch=${CATCH ? "yes" : "no"}, dmg=${DMG})`));
