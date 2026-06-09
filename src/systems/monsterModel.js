// Shared monster VISUAL-MODEL vocabulary used by BOTH the procedural renderer
// (src/systems/spritegen.js — the archetype-fallback silhouette set) and the server content
// seeder (server/content.js). Framework-free (no DOM, no server deps) so both the client
// renderer and the Node server import it safely.
//
// NOTE: the AI builder no longer selects from a fixed bodyShape/feature vocabulary — it authors
// each creature FROM SCRATCH as 2D shape primitives (see src/systems/modelRender.js:
// AUTHORED_MODEL_SCHEMA + authoredModelBrief). The old archetype-description / feature-overlay
// vocabulary (ARCHETYPE_DESC, FEATURE_VOCAB, canonicalFeature, renderEnvironmentBrief, …) that
// lived here drove that abandoned model and was removed 2026-06-10; only the six fallback
// silhouettes remain, and they are now used solely by the model-less offline seed bundle.

// The six silhouette archetypes the procedural renderer rigs to (drawBeast/drawRaptor/…). Used
// for the offline seed monsters (which carry no authored model) and as a content-seed hint.
export const BODY_SHAPES = ["beast", "raptor", "saurian", "leviathan", "arthropod", "brute"];
