// TQ-175: one-off generator for the "Combat / Fight Logic" report deck (for Dominik's TQ-109 review).
// Run: node tools/fight-logic-deck.mjs  → writes tools/_fightlogic.pptx (attached to TQ-175 in Jira).
// Verbatim prompts are imported from server/prompts.js (DEFAULT_PROMPTS) so they can never drift from
// the live defaults. Styling mirrors tools/status-report.mjs.
import pptxgen from "pptxgenjs";
import { DEFAULT_PROMPTS } from "../server/prompts.js";
import { DEFAULT_AI_CONFIG } from "../server/aiconfig.js";

const C = { bg: "0C0A14", panel: "16131F", panel2: "221D31", line: "322A47", text: "ECF4EF", mut: "8A8AA8",
  teal: "46E6C6", ember: "F2683C", amber: "E0A85C", violet: "9B7FE6", ok: "4BD18C", bad: "E0524A" };

const p = new pptxgen();
p.defineLayout({ name: "W", width: 13.33, height: 7.5 });
p.layout = "W";
p.theme = { headFontFace: "Segoe UI", bodyFontFace: "Segoe UI" };

const slide = (title, sub) => {
  const s = p.addSlide();
  s.background = { color: C.bg };
  if (title) {
    s.addText(title, { x: 0.6, y: 0.32, w: 12.1, h: 0.7, fontSize: 25, bold: true, color: C.teal });
    if (sub) s.addText(sub, { x: 0.62, y: 0.98, w: 12.1, h: 0.4, fontSize: 13, color: C.mut });
    s.addShape(p.ShapeType.line, { x: 0.6, y: sub ? 1.4 : 1.06, w: 12.1, h: 0, line: { color: C.line, width: 1 } });
  }
  return s;
};
// A bulleted text block.
const bullets = (s, items, o = {}) => s.addText(
  items.map((t) => (typeof t === "string"
    ? { text: t, options: { bullet: { code: "2022" }, color: C.text, fontSize: o.fontSize || 14, paraSpaceAfter: 6 } }
    : { text: t.t, options: { bullet: t.sub ? { indentLevel: 1, code: "25AA" } : { code: "2022" }, color: t.color || C.text, fontSize: t.fontSize || o.fontSize || 14, bold: !!t.bold, indentLevel: t.sub ? 1 : 0, paraSpaceAfter: 5 } })),
  { x: o.x ?? 0.7, y: o.y ?? 1.7, w: o.w ?? 12.0, h: o.h ?? 5.4, valign: "top" });
// A verbatim prompt card (monospace, small) on a panel.
const promptCard = (s, label, body, o = {}) => {
  const x = o.x ?? 0.7, y = o.y ?? 1.65, w = o.w ?? 12.0, h = o.h ?? 5.5;
  s.addShape(p.ShapeType.roundRect, { x, y, w, h, rectRadius: 0.06, fill: { color: C.panel }, line: { color: C.line, width: 1 } });
  if (label) s.addText(label, { x: x + 0.18, y: y + 0.12, w: w - 0.36, h: 0.3, fontSize: 11, bold: true, color: C.amber });
  s.addText(body, { x: x + 0.22, y: y + (label ? 0.5 : 0.18), w: w - 0.44, h: h - (label ? 0.7 : 0.36), fontSize: o.fontSize || 10.5, color: C.text, fontFace: "Consolas", valign: "top", lineSpacingMultiple: 1.02 });
};

// ── 1. Title ──
{
  const s = p.addSlide(); s.background = { color: C.bg };
  s.addShape(p.ShapeType.rect, { x: 0, y: 3.1, w: 13.33, h: 0.04, fill: { color: C.ember } });
  s.addText("Tamer's Quest", { x: 0.8, y: 1.6, w: 11.7, h: 1.0, fontSize: 50, bold: true, color: C.teal });
  s.addText("Combat / Fight Logic — how the AI-resolved fight works", { x: 0.82, y: 2.62, w: 11.7, h: 0.6, fontSize: 23, color: C.text });
  s.addText("A walkthrough of the turn resolver, the AI judge (v1 vs v2), the verbatim prompts, and the safety/clamping — prepared for the fight-logic review (TQ-109 / TQ-175).", { x: 0.82, y: 3.3, w: 11.5, h: 0.8, fontSize: 14, color: C.mut });
  s.addText("Source of truth: server/ai.js · server/judge.js · server/prompts.js · server/aiconfig.js · server/combat.js", { x: 0.82, y: 4.5, w: 11.7, h: 0.4, fontSize: 12, italic: true, color: C.mut });
}

// ── 2. Big picture ──
{
  const s = slide("The big picture", "Combat is AI-resolved by design — the deterministic engine is only a crash-net");
  bullets(s, [
    { t: "Combat is RESOLVED BY AN AI JUDGE, one turn at a time. This is the game's core selling point — not a scripted battle system.", bold: true },
    { t: "The deterministic engine (src/engine/combat.js resolveTurn) is NO LONGER a gameplay path. It runs ONLY as a transient “crash-net” for a single turn when an AI call fails, so a fight never hard-locks.", color: C.amber },
    { t: "Combat is gated on aiEnabled() upstream (an OPENAI_API_KEY must be set) — with no key, fights don't start at all (server/combat.js).", },
    { t: "Two judges exist: v1 (absolute values) and v2 (structured deltas). v2 is the DEFAULT today (aiconfig combatJudgeV2 = true).", color: C.teal },
    { t: "Every model output is UNTRUSTED: HP/energy are clamped, statuses validated, names treated as data (prompt-injection defense). Covered later.", },
    { t: "Capture (spirit chains) is a SEPARATE AI judge — a combat turn can never fabricate a catch.", },
  ]);
}

// ── 3. Turn-resolution flow ──
{
  const s = slide("Turn-resolution flow (end to end)", "server/combat.js aiTurn → server/ai.js → server/openai.js → apply + clamp");
  bullets(s, [
    { t: "1. combat.js aiTurn(...) is the single resolver for every turn (SP + PvP). If aiEnabled(): time the call + record metrics (TQ-40 recordTurn: latency / fallback / timeout), then await aiResolveTurn(...).", },
    { t: "2. ai.js aiResolveTurn picks the judge: v2 if combatJudgeV2 is on OR the action is an ITEM (items have no numeric fields, so only v2 can resolve them); else v1.", },
    { t: "3. It builds a USER prompt from the live monster state (describe / describeFull) + initiative + transcript, and calls chatJson(system, user).", },
    { t: "4. chatJson → openai.js openaiChatJson: one Chat Completions call returning a JSON object. Handles model param drift (gpt-5.x need max_completion_tokens; flagship models lock temperature/top_p → auto-retry without them). Bounded by AI_TIMEOUT_MS = 10s.", },
    { t: "5. The raw JSON is shaped + CLAMPED into the engine result format (v1: mapAiResult; v2: judge.js applyJudgeEdits per monster), then returned to combat.js to apply to live state.", },
    { t: "6. On ANY throw (timeout, API error, bad JSON) combat.js catches and resolves that ONE turn with the deterministic engine (crash-net), logs it, and the fight continues.", color: C.amber },
  ], { fontSize: 13.5 });
}

// ── 4. v1 vs v2 judge ──
{
  const s = slide("The AI judge: v1 (absolute) vs v2 (structured deltas)", "aiconfig combatJudgeV2 selects the path; v2 is today's default");
  s.addShape(p.ShapeType.roundRect, { x: 0.7, y: 1.65, w: 5.9, h: 5.3, rectRadius: 0.06, fill: { color: C.panel }, line: { color: C.line, width: 1 } });
  s.addShape(p.ShapeType.roundRect, { x: 6.85, y: 1.65, w: 5.78, h: 5.3, rectRadius: 0.06, fill: { color: C.panel }, line: { color: C.teal, width: 1.5 } });
  s.addText("v1 — absolute judge (fallback)", { x: 0.9, y: 1.8, w: 5.5, h: 0.4, fontSize: 15, bold: true, color: C.mut });
  bullets(s, [
    { t: "Used when combatJudgeV2 = false." },
    { t: "Input: stat-only descriptions (describe)." },
    { t: "Output: the NEW absolute HP/energy/status for each monster + a narrative." },
    { t: "Shaped by mapAiResult: clamp to [0,max], validate status, per-turn damage cap, narrative type-check." },
    { t: "No passives, no transcript, no items, no special actions." },
  ], { x: 0.9, y: 2.25, w: 5.5, h: 4.6, fontSize: 12.5 });
  s.addText("v2 — structured judge (DEFAULT)", { x: 7.05, y: 1.8, w: 5.4, h: 0.4, fontSize: 15, bold: true, color: C.teal });
  bullets(s, [
    { t: "Default today (combatJudgeV2 = true); ALWAYS used for item actions." },
    { t: "Input: FULL descriptions incl. passive + move text (describeFull) + last 8 transcript lines." },
    { t: "Output: sparse per-field EDITS — integers as DELTAS, status as a rewrite — a short display line, and an optional special section." },
    { t: "Applied by judge.js applyJudgeEdits (delta + clamp) + resolveSpecial (end / winner / instaWin / flee)." },
    { t: "Same return shape as v1 (+ special), so callers are unchanged." },
  ], { x: 7.05, y: 2.25, w: 5.4, h: 4.6, fontSize: 12.5 });
}

// ── 5. v1 combat prompt (verbatim) ──
{
  const s = slide("The turn prompt — combatSystem (v1, verbatim)", "server/prompts.js DEFAULT_PROMPTS.combatSystem — admin-overridable live");
  promptCard(s, "system prompt", DEFAULT_PROMPTS.combatSystem, { fontSize: 9.6 });
}

// ── 6. v2 judge prompt (verbatim) ──
{
  const s = slide("The judge prompt — combatJudgeV2System (DEFAULT, verbatim)", "server/prompts.js DEFAULT_PROMPTS.combatJudgeV2System");
  promptCard(s, "system prompt", DEFAULT_PROMPTS.combatJudgeV2System, { fontSize: 10.5 });
}

// ── 7. catch judge prompt (verbatim) ──
{
  const s = slide("The capture prompt — catchJudgeSystem (verbatim)", "server/ai.js aiResolveCatch — a SEPARATE judge; a turn can never fabricate a catch");
  promptCard(s, "system prompt", DEFAULT_PROMPTS.catchJudgeSystem, { fontSize: 10.5, h: 4.3 });
  bullets(s, [
    { t: "User prompt = chain name + its authored BINDING POWER (catchPrompt) + the wild monster's HP%/energy/status; the judge weighs power vs how weakened the target is.", fontSize: 12 },
    { t: "No rarity tiers, gates, or capture formula — the judge owns the verdict. Output is tiny: caught (1/0) + a short fight-screen line.", fontSize: 12 },
  ], { x: 0.7, y: 6.05, w: 12.0, h: 1.2 });
}

// ── 8. Building the user prompt + injection defense ──
{
  const s = slide("How the user prompt is built", "Live state in; every free-text field sanitized at the source");
  bullets(s, [
    { t: "describe(label, monster, attack) [v1] — name, element, HP/energy, the five stats, current status, and the chosen move's numbers (dmg/acc/energy/crit/inflicted status)." },
    { t: "describeFull(...) [v2] — the above PLUS the monster's passiveEffect and the move's text description, so passives + move semantics are judged." },
    { t: "Initiative line — “PLAYER/ENEMY acts first (initiative)” when an ambush or a landed chain forces order (parity with the deterministic engine)." },
    { t: "Transcript [v2] — the last 8 fight lines, numbered, so the judge has history/continuity." },
    { t: "Item action [v2] — replaces the player's attack: “uses an item: <name> — <desc>”; resolved like an attack." },
    { t: "sanitizePromptText() wraps EVERY interpolated free-text field: folds control chars (newlines, DEL, C1, line/para separators) to spaces, collapses runs, caps length. Defense-in-depth so a crafted monster/attack name can't break out of its line or inject instructions — holds even if the model ignores the “treat names as data” rule.", color: C.amber },
  ], { fontSize: 13 });
}

// ── 9. Outputs, result shape & safety ──
{
  const s = slide("Outputs, result shape & safety (untrusted-output handling)", "Nothing the model returns is trusted verbatim");
  bullets(s, [
    { t: "Result shape (both judges): { player:{currentHealth,currentEnergy,status}, enemy:{...}, narrative, [special] }.", bold: true },
    { t: "mapAiResult (v1): HP/energy clamped to [0, max] (non-finite → previous value); status accepted only as a non-empty STRING, canonicalized via normalizeStatus + capped 24 chars; narrative must be a non-empty string else a safe fallback (“The monsters clash!”), control-stripped + clean length-clamp." },
    { t: "applyJudgeEdits (v2): only whitelisted fields apply — integer DELTAS (currentHealth/energy + the 5 stats) added then clamped to [0,max]; status the only string rewrite (so a rewrite can't clobber name/element); unknown fields ignored." },
    { t: "Per-turn damage cap (Task 78, combatMaxTurnDamageFrac): a single turn can't drain more than that fraction of MAX HP — heals & already-low monsters pass through. Applies on BOTH paths. Default 1 = OFF.", color: C.amber },
    { t: "resolveSpecial (v2): endBattle / winner / instaWin / flee normalized to {end, winner, flee, reason}; reason control-stripped + capped 80; an invalid winner is dropped." },
    { t: "Capture: caught accepted only as 1/“1”/true; text type-checked + clamped. Throws fail safe (no deterministic catch formula reintroduced)." },
  ], { fontSize: 12.5 });
}

// ── 10. Tunables ──
{
  const s = slide("Tunables — all live-editable in /admin (aiconfig)", "server/aiconfig.js DEFAULT_AI_CONFIG · DB-persisted overrides applied without redeploy");
  const cfg = DEFAULT_AI_CONFIG;
  const rows = [
    ["Setting", "Default", "What it does"],
    ["model", String(cfg.model), "The combat-judge model (cheap/fast per turn; pick gpt-5.5 for max quality)."],
    ["combatJudgeV2", String(cfg.combatJudgeV2), "ON = structured delta judge (default); OFF = v1 absolute judge."],
    ["combatTemperature", String(cfg.combatTemperature), "Sampling temperature for turn resolution."],
    ["maxTokens", String(cfg.maxTokens), "Response cap per turn (sent as max_completion_tokens)."],
    ["topP", String(cfg.topP), "Nucleus sampling (1 = off)."],
    ["combatMaxTurnDamageFrac", String(cfg.combatMaxTurnDamageFrac), "Max fraction of MAX HP a monster can lose in one AI turn (1 = off)."],
  ];
  s.addTable(rows, {
    x: 0.7, y: 1.7, w: 12.0, colW: [3.0, 1.3, 7.7], fontSize: 12.5, color: C.text, valign: "middle",
    border: { type: "solid", color: C.line, pt: 1 }, fill: { color: C.panel },
    rowH: [0.45, 0.55, 0.55, 0.45, 0.5, 0.45, 0.6],
  });
  s.addText("openai.js absorbs model param drift: gpt-5.x require max_completion_tokens; flagship gpt-5.x lock temperature/top_p and 400 a custom value → the call auto-retries without them, so any listed model resolves.",
    { x: 0.7, y: 6.35, w: 12.0, h: 0.8, fontSize: 12, italic: true, color: C.mut });
}

// ── 11. Risks / edge cases ──
{
  const s = slide("Risks & edge cases (for the review)", "What to scrutinize");
  bullets(s, [
    { t: "Latency / cost: one model call per turn (10s timeout). A slow/failed call drops to the crash-net engine for that turn — playable, but a single turn then ignores passives/items/specials.", color: C.amber },
    { t: "Damage cap OFF by default (frac = 1): nothing structurally stops the judge from swinging a near-full monster very low in one turn beyond the “not wildly swingy” prompt guidance. Consider setting <1 if turns feel too swingy." },
    { t: "Elements are FLAVOUR ONLY by design — the prompts explicitly forbid type-effectiveness. Confirm this is the intended combat identity." },
    { t: "Status is semi-free-text: unknown labels are kept (capped) and the prompt instructs the model to map them to a real effect; mechanics only fire for canonical kinds (burn/stun/weaken/...) via normalizeStatus." },
    { t: "v2 special actions let the judge END a battle / declare a winner / flee — powerful. resolveSpecial bounds it, but a mis-judged instaWin would end a fight; worth eyeballing in transcripts." },
    { t: "Prompt-injection: names/descriptions are sanitized + flagged as untrusted in every prompt; the clamps are the real backstop if the model is ever convinced otherwise." },
  ], { fontSize: 12.5 });
}

// ── 12. File map / summary ──
{
  const s = slide("Where to look — file map", "");
  bullets(s, [
    { t: "server/combat.js — aiTurn(): the per-turn entry; metrics + crash-net fallback. Also the capture + enemy-turn flow.", },
    { t: "server/ai.js — aiResolveTurn / resolveTurnV2 / aiResolveCatch, describe / describeFull / describeCatchTarget, mapAiResult (v1 clamp), sanitizePromptText, trimNarrative.", },
    { t: "server/judge.js — applyJudgeEdits (v2 delta+clamp), resolveSpecial, JUDGE_V2_SCHEMA, INT_FIELDS / STR_FIELDS whitelists.", },
    { t: "server/prompts.js — DEFAULT_PROMPTS.{combatSystem, combatJudgeV2System, catchJudgeSystem} (admin-overridable).", },
    { t: "server/aiconfig.js — DEFAULT_AI_CONFIG combat dials + validation; live overrides via /admin.", },
    { t: "server/openai.js — openaiChatJson: the model call + param-drift handling. server/aiMetrics.js — recordTurn observability (TQ-40).", },
    { t: "Fallback only: src/engine/combat.js resolveTurn (deterministic crash-net).", color: C.mut },
  ], { fontSize: 13 });
}

const OUT = "tools/_fightlogic.pptx";
await p.writeFile({ fileName: OUT });
console.log("wrote", OUT);
