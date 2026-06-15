// Shared monster VISUAL-MODEL vocabulary used by BOTH the procedural renderer
// (src/systems/spritegen.js — the archetype-fallback silhouette set) and the server content
// seeder (server/content.js). Framework-free (no DOM, no server deps) so both the client
// renderer and the Node server import it safely.
//
// NOTE: the AI builder no longer selects from a fixed bodyShape/feature vocabulary — it authors each
// creature FROM SCRATCH as free-form HTML/CSS (src/systems/htmlModel.js, rendered as a live-DOM node).
// (The interim SVG builder was removed in TQ-264; the older shapes system before that.) The old
// archetype-description / feature-overlay vocabulary (ARCHETYPE_DESC, FEATURE_VOCAB, …) and the
// authored-shapes system (modelRender.js) that succeeded it were both removed (2026-06-10 / the SVG
// cutover TQ-242); only the six fallback silhouettes remain, used solely by the model-less offline
// seed bundle (which the procedural renderer in spritegen.js bakes at boot).

// The six silhouette archetypes the procedural renderer rigs to (drawBeast/drawRaptor/…). Used
// for the offline seed monsters (which carry no authored model) and as a content-seed hint.
export const BODY_SHAPES = ["beast", "raptor", "saurian", "leviathan", "arthropod", "brute"];
