const freshScene = (name, data) => ({ name, data: data || {}, updates: [], draws: [], leaveCbs: [] });
const remove = (arr, x) => { const i = arr.indexOf(x); if (i >= 0) arr.splice(i, 1); };

function recordSceneError(phase, e) {
  try {
    const ring = globalThis.__drawErrs || (globalThis.__drawErrs = []);
    const msg = `${phase}: ${(e && e.message) || e}`;
    if (ring[ring.length - 1] === msg) return;
    ring.push(msg);
    if (ring.length > 50) ring.shift();
  } catch {}
}

export function makeSceneManager() {
  const defs = new Map();
  let active = null;
  let lastGo = null;

  function leave() {
    if (!active) return;
    const cbs = active.leaveCbs.slice();
    active = null; // clear first so leave callbacks can't re-enter this scene
    for (const cb of cbs) { try { cb(); } catch (e) { recordSceneError("leave", e); } }
  }

  return {
    scene(name, fn) { defs.set(name, fn); },
    has(name) { return defs.has(name); },

    go(name, data) {
      if (!defs.has(name)) return false;
      leave();
      active = freshScene(name, data);
      lastGo = { name, data: data || {} };
      try { defs.get(name)(active.data); } catch (e) { recordSceneError(`setup:${name}`, e); }
      return true;
    },

    onUpdate(cb) { if (active) active.updates.push(cb); const s = active; return { cancel() { if (s) remove(s.updates, cb); } }; },
    onDraw(cb) { if (active) active.draws.push(cb); const s = active; return { cancel() { if (s) remove(s.draws, cb); } }; },
    onSceneLeave(cb) { if (active) active.leaveCbs.push(cb); const s = active; return { cancel() { if (s) remove(s.leaveCbs, cb); } }; },

    update(dt) { if (active) for (const cb of active.updates.slice()) { try { cb(dt); } catch (e) { recordSceneError(`update:${active && active.name}`, e); } } },
    draw(renderer, dt) { if (active) for (const cb of active.draws.slice()) { try { cb(renderer, dt); } catch (e) { recordSceneError(`draw:${active && active.name}`, e); } } },

    current() { return active && active.name; },
    lastGo() { return lastGo; },
    stop() { leave(); },
  };
}
