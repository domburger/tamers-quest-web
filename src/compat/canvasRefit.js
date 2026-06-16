// TQ-283 (Phase 4, engine-removal TQ-227/231): responsive refit for the canvas backend, matching the
// shim's resize/orientation handling (kaboomShim.js:407). makeCanvasRuntime already recomputes the
// DPR×FIT on a window "resize"; this adds the robustness around it — a debounce, the MOBILE SOFT-KEYBOARD
// guard, orientationchange + visualViewport listeners, and a scene relayout that re-lays-out retained
// menu scenes while leaving live gameplay scenes running. No Phaser, no canvas drawing.

// Scenes whose retained layout must NOT be reset by a refit (an active run would be lost) — their canvas
// still re-fits; only non-gameplay (menu) scenes are re-run. Mirrors the shim's GAMEPLAY set.
export const DEFAULT_GAMEPLAY_SCENES = new Set(["game", "onlineGame", "fight"]);

/**
 * Whether a DOM element is a text-entry field. While one is focused the soft keyboard is (likely) open,
 * so a refit must be SUPPRESSED — on Android the keyboard shrinks innerHeight, the aspect changes, and a
 * relayout would restart the menu scene (its onSceneLeave removes the <input>), snapping the keyboard shut.
 * @param {Element|null} activeElement @returns {boolean}
 */
export function isTextInputFocused(activeElement) {
  const ae = activeElement;
  return !!(ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable));
}

/**
 * Debounced, keyboard-guarded refit driver. Attaches resize/orientationchange/visualViewport.resize
 * listeners; after `debounceMs` of quiet it calls onRefit() — UNLESS a text input is focused. `schedule`/
 * `clear`/`target`/`getActiveElement` are injectable so the debounce + guard are unit-testable headless.
 * @param {{onRefit:Function, debounceMs?:number, target?:any, getActiveElement?:()=>any, schedule?:Function, clear?:Function}} opts
 */
export function makeRefitter({ onRefit, debounceMs = 180, target, getActiveElement, schedule, clear } = {}) {
  const win = target || (typeof window !== "undefined" ? window : null);
  const getAE = getActiveElement || (() => (typeof document !== "undefined" ? document.activeElement : null));
  const setT = schedule || (typeof setTimeout !== "undefined" ? setTimeout : null);
  const clrT = clear || (typeof clearTimeout !== "undefined" ? clearTimeout : null);
  let timer = null;

  const fire = () => {
    if (clrT) clrT(timer);
    const run = () => { if (!isTextInputFocused(getAE())) { try { onRefit && onRefit(); } catch (e) { void e; } } };
    timer = setT ? setT(run, debounceMs) : (run(), null);
  };

  const subs = [];
  const add = (t, type) => { if (t && t.addEventListener) { t.addEventListener(type, fire, { passive: true }); subs.push([t, type]); } };
  if (win) {
    add(win, "resize");
    add(win, "orientationchange");
    // Fullscreen (F11 / Fullscreen API) toggles the viewport size/aspect; relayout retained menu UI to it.
    // fullscreenchange bubbles to window, and firing it here (debounced) ensures the relayout runs even if
    // the transition's `resize` was flaky. webkit* is the older Safari prefix.
    add(win, "fullscreenchange");
    add(win, "webkitfullscreenchange");
    if (win.visualViewport) add(win.visualViewport, "resize");
  }

  return {
    /** Manually trigger the debounced refit (also what the listeners call). */
    trigger: fire,
    dispose() {
      if (clrT) clrT(timer);
      for (const [t, type] of subs) { try { t.removeEventListener(type, fire); } catch (e) { void e; } }
      subs.length = 0;
    },
  };
}

/**
 * Re-lay-out the active scene on a refit: re-run lastGo() for a NON-gameplay (menu) scene so its retained
 * objects reflow to the new size; gameplay scenes are left running (the canvas re-fits without a restart).
 * @param {{current:()=>(string|null), lastGo:()=>({name:string,data:any}|null), go:Function}} sceneManager
 * @param {Set<string>} [gameplayScenes]
 */
export function relayoutScenes(sceneManager, gameplayScenes = DEFAULT_GAMEPLAY_SCENES) {
  if (!sceneManager) return false;
  const cur = sceneManager.current();
  const last = sceneManager.lastGo();
  if (cur && last && !gameplayScenes.has(cur)) { sceneManager.go(last.name, last.data); return true; }
  return false;
}
