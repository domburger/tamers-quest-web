// TQ-477 (RT-NET 3/5): binary wire codec for the hot `snapshot` message. Snapshots are the only
// high-frequency server→client message; encoding them as a packed buffer instead of JSON drops all the
// field-name/quote/delimiter overhead and packs positions as fixed ints. HYBRID by design: the
// high-frequency numeric parts (tick, the per-tick `you` scalars, and the entity delta arrays) are packed
// binary, while the low-frequency heterogeneous parts (roundId, time, circle, portals, youMeta) ride as a
// single length-prefixed JSON tail — those change rarely (TQ-493) so the JSON cost is amortized, and it
// keeps the nested/variable shapes (team[], chains[], upgrades{}) simple and forward-compatible.
//
// Shared by the Node server (server/index.js send path) and the browser client (src/net.js onmessage).
// Pure: uses only TextEncoder/TextDecoder/DataView (present in Node 18+ and browsers). Control messages
// (welcome/roundStart/combat/…) stay JSON — only `snapshot` goes binary.
const VER = 1;
const COORD_BIAS = 40000;     // i32 coords are sent unbiased; bias only guards the u16 danger/stamina packers below
const _enc = new TextEncoder();
const _dec = new TextDecoder();

// Growable little-endian writer.
class Writer {
  constructor() { this.u8a = new Uint8Array(512); this.view = new DataView(this.u8a.buffer); this.pos = 0; }
  _ensure(n) {
    if (this.pos + n <= this.u8a.length) return;
    let cap = this.u8a.length * 2;
    while (cap < this.pos + n) cap *= 2;
    const nb = new Uint8Array(cap); nb.set(this.u8a);
    this.u8a = nb; this.view = new DataView(nb.buffer);
  }
  u8(v) { this._ensure(1); this.view.setUint8(this.pos, v & 0xff); this.pos += 1; }
  u16(v) { this._ensure(2); this.view.setUint16(this.pos, v & 0xffff, true); this.pos += 2; }
  u32(v) { this._ensure(4); this.view.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
  i32(v) { this._ensure(4); this.view.setInt32(this.pos, v | 0, true); this.pos += 4; }
  // length-prefixed UTF-8 string (u16 length → ids/names are short)
  str(s) { const b = _enc.encode(s == null ? "" : String(s)); this.u16(b.length); this._ensure(b.length); this.u8a.set(b, this.pos); this.pos += b.length; }
  // length-prefixed UTF-8 blob with a u32 length (for the JSON meta tail, which can exceed 64KB in theory)
  blob(s) { const b = _enc.encode(s == null ? "" : String(s)); this.u32(b.length); this._ensure(b.length); this.u8a.set(b, this.pos); this.pos += b.length; }
  bytes() { return this.u8a.subarray(0, this.pos); }
}

class Reader {
  constructor(u8) { this.u8a = u8; this.view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.pos = 0; }
  u8() { const v = this.view.getUint8(this.pos); this.pos += 1; return v; }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  str() { const n = this.u16(); const s = _dec.decode(this.u8a.subarray(this.pos, this.pos + n)); this.pos += n; return s; }
  blob() { const n = this.u32(); const s = _dec.decode(this.u8a.subarray(this.pos, this.pos + n)); this.pos += n; return s; }
}

// ── per-category entity packers (mirror the server's snapshot view-object fields) ──
const TIER_NULL = 255; // u8 sentinel for a null chainTier/level
function wPlayers(w, arr) { w.u16(arr.length); for (const o of arr) { w.str(o.id); w.i32(o.x | 0); w.i32(o.y | 0); w.str(o.name); w.str(o.skinId || ""); w.str(o.charId || ""); w.u8(o.chainTier == null ? TIER_NULL : o.chainTier); } }
function rPlayers(r) { const n = r.u16(), a = []; for (let i = 0; i < n; i++) { const id = r.str(), x = r.i32(), y = r.i32(), name = r.str(), skinId = r.str(), charId = r.str(), ct = r.u8(); a.push({ id, x, y, name, skinId: skinId || null, charId: charId || null, chainTier: ct === TIER_NULL ? null : ct }); } return a; }
function wMonsters(w, arr) { w.u16(arr.length); for (const o of arr) { w.str(o.id); w.i32(o.x | 0); w.i32(o.y | 0); w.str(o.typeName); w.u8(o.level == null ? TIER_NULL : o.level); } }
function rMonsters(r) { const n = r.u16(), a = []; for (let i = 0; i < n; i++) { const id = r.str(), x = r.i32(), y = r.i32(), typeName = r.str(), lv = r.u8(); a.push({ id, x, y, typeName, level: lv === TIER_NULL ? null : lv }); } return a; }
function wProj(w, arr) { w.u16(arr.length); for (const o of arr) { w.str(o.id); w.str(o.owner || ""); w.i32(o.x | 0); w.i32(o.y | 0); w.i32(Math.round(o.vx || 0)); w.i32(Math.round(o.vy || 0)); w.str(o.chainId || ""); } }
function rProj(r) { const n = r.u16(), a = []; for (let i = 0; i < n; i++) { const id = r.str(), owner = r.str(), x = r.i32(), y = r.i32(), vx = r.i32(), vy = r.i32(), chainId = r.str(); a.push({ id, owner: owner || null, x, y, vx, vy, chainId: chainId || null }); } return a; }
function wChests(w, arr) { w.u16(arr.length); for (const o of arr) { w.str(o.id); w.i32(o.x | 0); w.i32(o.y | 0); } }
function rChests(r) { const n = r.u16(), a = []; for (let i = 0; i < n; i++) { const id = r.str(), x = r.i32(), y = r.i32(); a.push({ id, x, y }); } return a; }
function wGone(w, arr) { const g = arr || []; w.u16(g.length); for (const id of g) w.str(id); }
function rGone(r) { const n = r.u16(), a = []; for (let i = 0; i < n; i++) a.push(r.str()); return a; }

/**
 * Encode a snapshot message → Uint8Array. The message shape is exactly what server/world.js builds
 * (post TQ-476/TQ-493): { t:"snapshot", tick, roundId, full, you:{id,x,y,ack,stamina,danger}, time,
 * circle, portals, youMeta?, players?/pGone?, monsters?/mGone?, projectiles?/prGone?, chests?/chGone? }.
 */
export function encodeSnapshot(m) {
  const w = new Writer();
  const you = m.you || {};
  w.u8(VER);
  w.u8(m.full ? 1 : 0);
  w.u32(m.tick >>> 0);
  w.i32(you.x | 0);
  w.i32(you.y | 0);
  w.u32((you.ack || 0) >>> 0);
  w.u8(Math.max(0, Math.min(255, Math.round(you.stamina || 0))));
  w.u16(Math.max(0, Math.min(65535, Math.round((you.danger || 0) * 1000)))); // danger 0..1 → 0..1000
  w.str(you.id || "");
  // JSON tail for the rarely-changing / heterogeneous fields (COORD_BIAS referenced to keep the constant live for future packers)
  void COORD_BIAS;
  const meta = { r: m.roundId, t: m.time, c: m.circle || null, p: m.portals || [] };
  if (m.youMeta) meta.y = m.youMeta;
  w.blob(JSON.stringify(meta));
  // entity delta sections (counts are always written; 0 = no entries / absent on the wire)
  wPlayers(w, m.players || []); wGone(w, m.pGone);
  wMonsters(w, m.monsters || []); wGone(w, m.mGone);
  wProj(w, m.projectiles || []); wGone(w, m.prGone);
  wChests(w, m.chests || []); wGone(w, m.chGone);
  return w.bytes();
}

/** Decode a snapshot Uint8Array/ArrayBuffer → the message object (matching the JSON shape). */
export function decodeSnapshot(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  const r = new Reader(u8);
  const ver = r.u8();
  if (ver !== VER) throw new Error(`snapshot codec version ${ver} != ${VER}`);
  const full = r.u8() === 1;
  const tick = r.u32();
  const youX = r.i32(), youY = r.i32(), ack = r.u32(), stamina = r.u8(), danger = r.u16() / 1000;
  const youId = r.str();
  const meta = JSON.parse(r.blob());
  const players = rPlayers(r), pGone = rGone(r);
  const monsters = rMonsters(r), mGone = rGone(r);
  const projectiles = rProj(r), prGone = rGone(r);
  const chests = rChests(r), chGone = rGone(r);
  const m = {
    t: "snapshot", tick, full,
    roundId: meta.r, time: meta.t, circle: meta.c || null, portals: meta.p || [],
    you: { id: youId, x: youX, y: youY, ack, stamina, danger },
  };
  if (meta.y) m.youMeta = meta.y;
  // Re-attach only non-empty entity fields, matching the server's omit-empty JSON shape (so the client
  // delta-merge sees an identical message whether it arrived as JSON or binary).
  if (players.length) m.players = players; if (pGone.length) m.pGone = pGone;
  if (monsters.length) m.monsters = monsters; if (mGone.length) m.mGone = mGone;
  if (projectiles.length) m.projectiles = projectiles; if (prGone.length) m.prGone = prGone;
  if (chests.length) m.chests = chests; if (chGone.length) m.chGone = chGone;
  return m;
}
