import { THEME, addMenuBackground, drawToast, inRect } from "../ui/theme.js";
import { drawStationPopup, stationContentRect, stationCloseRect } from "../ui/stationPopup.js";
import { drawProfilePanel, drawProfileModal, profilePanelState, profilePanelTap, profilePanelScroll } from "../ui/profilePanel.js";

// Profile page: the login indicator's detail view (avatar, editable username, lifetime player data, team,
// per-run match history). UI v4: this standalone page renders the SAME sheet + content module as the
// village's Profile popup (ui/stationPopup.js + ui/profilePanel.js) instead of keeping a second, older copy
// of the layout. Reachable from the character-select identity chip and the account page (both carry Sign
// out); the village opens the popup directly. The sheet's close button and Esc go back. The module owns data
// loading (/account/me for accounts, local data for guests), the per-tamer stats selector and rename.
export default function profileScene(k) {
  k.scene("profile", (args = {}) => {
    addMenuBackground(k);
    const backScene = args.backScene || "characterSelect"; // lobby dropdown passes "lobby"; chip passes nothing
    const backArgs = args.backArgs;
    const state = profilePanelState(args.characterId || null);
    const openedT = k.time();
    const busy = () => !!state.renaming; // the rename modal captures input
    const goBack = () => { state.dispose(); k.go(backScene, backArgs); };

    let toast = null;
    const showToast = (text) => { toast = { text, until: k.time() + 2.2 }; };

    k.onDraw(() => {
      drawStationPopup(k, { title: "Profile", eyebrow: "Your account", icon: "person", accent: THEME.primary, openedT, pointer: k.mousePos(),
        content: (kk, rect) => drawProfilePanel(kk, rect, state) });
      drawProfileModal(k, state); // the rename modal, full screen, outside the clip
      if (toast) { const t = toast.until - k.time(); if (t > 0) drawToast(k, { text: toast.text, t }); else toast = null; }
    });

    // Input: tap = close button or profilePanelTap; drag (touch or mouse) and the wheel scroll the content.
    let press = null;
    k.onMousePress(() => { press = { y: k.mousePos().y, last: k.mousePos().y, moved: false }; });
    k.onMouseMove(() => {
      if (!press || busy()) return;
      const y = k.mousePos().y;
      if (Math.abs(y - press.y) > 6) press.moved = true;
      if (press.moved) { profilePanelScroll(state, press.last - y); press.last = y; }
    });
    k.onMouseRelease(() => {
      const p = press; press = null;
      if (p && p.moved && !busy()) return;
      const m = k.mousePos();
      if (!busy() && inRect(m, stationCloseRect(k))) { goBack(); return; }
      profilePanelTap(k, stationContentRect(k), state, m, showToast);
    });
    k.onScroll((d) => { if (!busy()) profilePanelScroll(state, (d?.y || 0) * 0.5); });
    k.onKeyPress("escape", () => { if (busy()) { state.dispose(); return; } goBack(); });
    k.onSceneLeave(() => state.dispose());
  });
}
