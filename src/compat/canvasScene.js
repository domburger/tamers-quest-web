// TQ-282 (Phase 4, engine-removal TQ-227/231): scene management for the canvas backend, mirroring the
// shim's k.scene/go/onSceneLeave/onUpdate/onDraw (kaboomShim.js:390). A scene is a setup fn registered by
// name; go() tears the current scene down (fires its onSceneLeave cbs + clears its update/draw lists) and
// runs the next one's setup, which registers per-frame onUpdate/onDraw against the now-active scene. The
// host loop calls update(dt) then draw(renderer,dt) each frame. Pure lifecycle — no Phaser, no canvas.

const freshScene = (name, data) => ({ name, data: data || {}, updates: [], draws: [], leaveCbs: [] });
const remove = (arr, x) => { const i = arr.indexOf(x); if (i >= 0) arr.splice(i, 1); };

// Every scene callback below is wrapped so one broken scene can't kill the loop — but a silently
// swallowed error (e.g. a ReferenceError surviving a refactor) then renders an INVISIBLY broken scene.
// Record swallowed errors into a small capped ring on globalThis (__drawErrs): the QA scene tours
// (tools/_tq233scenes.mjs, _tq233charselect.mjs) already read it, and it's reachable from a live
// console — all WITHOUT changing the resilience behaviour (the error stays caught). Consecutive
// duplicates collapse so a per-frame throw can't flood the ring; capped so it can't grow unbounded.
// Runs ONLY on the catch path, so it adds zero overhead when scenes don't throw.
function recordSceneError(phase, e) {
  try {
    const ring = globalThis.__drawErrs || (globalThis.__drawErrs = []);
    const msg = `${phase}: ${(e && e.message) || e}`;
    if (ring[ring.length - 1] === msg) return; // collapse a per-frame repeat
    ring.push(msg);
    if (ring.length > 50) ring.shift();
  } catch { /* frozen / no globalThis */ }
}

export function makeSceneManager() {
  const defs = new Map();   // name -> setup fn
  let active = null;        // { name, data, updates, draws, leaveCbs }
  let lastGo = null;        // remembered { name, data } so a resize can re-run the scene

  // Tear down the active scene: fire its leave callbacks (once), drop it.
  function leave() {
    if (!active) return;
    const cbs = active.leaveCbs.slice();
    active = null;          // clear FIRST so onSceneLeave handlers can't re-enter this scene's lists
    for (const cb of cbs) { try { cb(); } catch (e) { recordSceneError("leave", e); } }
  }

  return {
    /** Register a scene setup fn under `name` (overwrites). */
    scene(name, fn) { defs.set(name, fn); },
    has(name) { return defs.has(name); },

    /** Switch to a registered scene: leave the current, run the new scene's setup with `data`. */
    go(name, data) {
      if (!defs.has(name)) return false;
      leave();
      active = freshScene(name, data);
      lastGo = { name, data: data || {} };
      try { defs.get(name)(active.data); } catch (e) { recordSceneError(`setup:${name}`, e); } // setup registers onUpdate/onDraw/onSceneLeave
      return true;
    },

    // Per-frame callbacks register against the ACTIVE scene (no-op before any go()).
    onUpdate(cb) { if (active) active.updates.push(cb); const s = active; return { cancel() { if (s) remove(s.updates, cb); } }; },
    onDraw(cb) { if (active) active.draws.push(cb); const s = active; return { cancel() { if (s) remove(s.draws, cb); } }; },
    onSceneLeave(cb) { if (active) active.leaveCbs.push(cb); const s = active; return { cancel() { if (s) remove(s.leaveCbs, cb); } }; },

    /** Run the active scene's update callbacks (dt in seconds). */
    update(dt) { if (active) for (const cb of active.updates.slice()) { try { cb(dt); } catch (e) { recordSceneError(`update:${active && active.name}`, e); } } },
    /** Run the active scene's draw callbacks with the renderer (the host clears + transforms first). */
    draw(renderer, dt) { if (active) for (const cb of active.draws.slice()) { try { cb(renderer, dt); } catch (e) { recordSceneError(`draw:${active && active.name}`, e); } } },

    current() { return active && active.name; },
    lastGo() { return lastGo; },
    /** Leave the active scene (e.g. on shutdown). */
    stop() { leave(); },
  };
}
