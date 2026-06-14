// TQ-262: the design→page-CSS-px mapping used to overlay DOM elements (the live-DOM monster layer) at
// a scene object's on-screen location. Kept PURE + separate from the kaboom/Phaser shim so the math is
// unit-testable without booting Phaser; the shim's k.worldToScreen() gathers the live camera + scale
// state and calls this.
//
// Coordinate chain (matches how the shim draws — see src/compat/kaboomShim.js):
//   design (0..W, 0..H, what scenes author in)
//     → buffer px  : × renderScale  (the canvas backing buffer is W·S × H·S)
//     → camera     : minus the camera scroll, for WORLD-space points (scrollFactor 1). Fixed/
//                    screen-anchored points (HUD) ignore scroll. The camera zoom is 1 (the shim
//                    pre-multiplies positions by S rather than zooming the camera).
//     → CSS px     : × (displayWidth / bufferWidth)  — Phaser FIT just CSS-stretches the buffer
//     → page px    : + the canvas's page offset (canvasBounds.left/top)
//
// Returns { x, y, scale } where (x,y) is the point in page CSS px and `scale` is CSS px per DESIGN
// unit (so a caller can size an overlaid box authored in design units to match the on-screen size).

export function worldToScreenPx({
  x, y,
  renderScale,
  bufferW, displayW,
  scrollX = 0, scrollY = 0,
  boundsLeft = 0, boundsTop = 0,
  fixed = false,
}) {
  const cssPerBuffer = bufferW > 0 ? displayW / bufferW : 1; // uniform FIT scale (height matches)
  const sx = fixed ? 0 : scrollX;
  const sy = fixed ? 0 : scrollY;
  const bufX = x * renderScale - sx;
  const bufY = y * renderScale - sy;
  return {
    x: boundsLeft + bufX * cssPerBuffer,
    y: boundsTop + bufY * cssPerBuffer,
    scale: renderScale * cssPerBuffer, // = displayW / designW : CSS px per design unit
  };
}
