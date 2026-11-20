// Never re-run on refit (would lose the run); add new gameplay scenes here.
export const DEFAULT_GAMEPLAY_SCENES = new Set(["game", "onlineGame", "fight"]);

// Suppress refit while typing: Android keyboard resize would kill the input.
export function isTextInputFocused(activeElement) {
  const ae = activeElement;
  return !!(ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable));
}

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
    add(win, "fullscreenchange");
    add(win, "webkitfullscreenchange");
    if (win.visualViewport) add(win.visualViewport, "resize");
  }

  return {
    trigger: fire,
    dispose() {
      if (clrT) clrT(timer);
      for (const [t, type] of subs) { try { t.removeEventListener(type, fire); } catch (e) { void e; } }
      subs.length = 0;
    },
  };
}

export function relayoutScenes(sceneManager, gameplayScenes = DEFAULT_GAMEPLAY_SCENES) {
  if (!sceneManager) return false;
  const cur = sceneManager.current();
  const last = sceneManager.lastGo();
  if (cur && last && !gameplayScenes.has(cur)) { sceneManager.go(last.name, last.data); return true; }
  return false;
}
