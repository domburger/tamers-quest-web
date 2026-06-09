// Verify the per-phase aiconfig works on prod: confirm the phase fields exist + round-trip a save.
// Run: railway run --service web -- node tools/verify-aiconfig.mjs
const T = process.env.ADMIN_TOKEN, B = process.env.BASE || "https://tamersquest.com";
if (!T) { console.error("no ADMIN_TOKEN"); process.exit(1); }
const h = { "x-admin-token": T, "content-type": "application/json" };

let r = await fetch(B + "/api/admin/aiconfig", { headers: h });
const a = await r.json();
const phases = ["genIdeaModel", "genAttributesModel", "genBuilderModel", "genIdeaTemperature", "genAttributesTemperature", "genBuilderTemperature", "itemInspirationModel", "itemDesignerModel", "model", "combatTemperature"];
console.log("all per-phase + combat fields present:", phases.every((k) => a.fields[k] !== undefined));
console.log("  builder model:", a.fields.genBuilderModel.current, "| idea:", a.fields.genIdeaModel.current, "| item designer:", a.fields.itemDesignerModel.current, "| combat:", a.fields.model.current);
console.log("  aiEnabled:", a.aiEnabled, "| modelOptions:", (a.modelOptions || []).join(", "));

r = await fetch(B + "/api/admin/aiconfig", { method: "POST", headers: h, body: JSON.stringify({ genBuilderTemperature: 0.55, genIdeaModel: "gpt-5.5" }) });
const o = await r.json();
console.log("save -> genBuilderTemperature:", o.aiconfig.fields.genBuilderTemperature.current, "| genIdeaModel:", o.aiconfig.fields.genIdeaModel.current);

await fetch(B + "/api/admin/aiconfig", { method: "POST", headers: h, body: JSON.stringify({ genBuilderTemperature: "", genIdeaModel: "" }) });
const back = await (await fetch(B + "/api/admin/aiconfig", { headers: h })).json();
console.log("reset -> genBuilderTemperature:", back.fields.genBuilderTemperature.current, "| genIdeaModel:", back.fields.genIdeaModel.current);
process.exit(0);
