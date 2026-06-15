// Postgres persistence seam for the profile store (P1-T2). Activates only when
// DATABASE_URL is set (Railway injects it from a linked Postgres). Without it the
// server runs fully in-memory and never imports `pg`, so local dev and CI need no
// database. On any connection failure we log and fall back to in-memory rather
// than crash — serving the game without durable profiles beats not serving at all.
//
// Schema: one row per profile, the whole PlayerProfile stored as JSONB keyed by
// its opaque session token (Q6 anonymous tokens). Last-write-wins upserts.

let pool = null;

export function dbEnabled() {
  return pool !== null;
}

// Connect (if DATABASE_URL is set) and ensure the schema. Returns true when the
// DB is live, false when running in-memory.
export async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  try {
    const pg = (await import("pg")).default;
    // Railway's internal URL (*.railway.internal) needs no TLS; the public proxy
    // and most managed PGs do. Opt in via sslmode=require or PGSSL=require.
    const ssl =
      /sslmode=require/.test(url) || process.env.PGSSL === "require"
        ? { rejectUnauthorized: false }
        : undefined;
    pool = new pg.Pool({ connectionString: url, ssl, max: 4 });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS profiles (
        token      TEXT PRIMARY KEY,
        id         TEXT NOT NULL,
        data       JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // AI-generated content (P5). One row per MonsterType, keyed by its name.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS monster_types (
        name       TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // AI-generated items (plan "Decide general items"). One row per item, keyed by name.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS generated_items (
        name       TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // AI-generated floor tiles + biomes (analogous to monsters/items). One row each, keyed by name.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS generated_ground_tiles (
        name       TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS generated_biomes (
        name       TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // Admin-tunable settings (P7). Single row of game-config overrides.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id         INT PRIMARY KEY,
        data       JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    // Accounts (cloud saves). An account owns N character profiles (its `data.characterTokens`
    // reference rows in `profiles`). Credentials live here, not on a game profile — so a
    // logged-in player's characters follow their account across devices. Keyed by session token.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        session_token TEXT PRIMARY KEY,
        id            TEXT NOT NULL,
        data          JSONB NOT NULL,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    return true;
  } catch (e) {
    console.error("[db] init failed; continuing in-memory:", e.message);
    if (pool) {
      try { await pool.end(); } catch {}
      pool = null;
    }
    return false;
  }
}

// Admin settings overrides (P7). {} when no DB or none saved.
export async function loadSettings() {
  if (!pool) return {};
  const { rows } = await pool.query("SELECT data FROM settings WHERE id = 1");
  return rows[0]?.data || {};
}

export async function saveSettings(obj) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO settings (id, data, updated_at) VALUES (1, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [JSON.stringify(obj)]
  );
}

// AI prompt overrides live in the same settings table under id 2 (P7 / admin).
export async function loadPrompts() {
  if (!pool) return {};
  const { rows } = await pool.query("SELECT data FROM settings WHERE id = 2");
  return rows[0]?.data || {};
}

export async function savePrompts(obj) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO settings (id, data, updated_at) VALUES (2, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [JSON.stringify(obj)]
  );
}

// AI model + generation params (admin-editable) live in the settings table under
// id 3. {} when no DB or none saved.
export async function loadAiConfig() {
  if (!pool) return {};
  const { rows } = await pool.query("SELECT data FROM settings WHERE id = 3");
  return rows[0]?.data || {};
}

export async function saveAiConfig(obj) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO settings (id, data, updated_at) VALUES (3, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [JSON.stringify(obj)]
  );
}

// Admin-editable schema field descriptions live in the settings table under id 4.
export async function loadSchemaDesc() {
  if (!pool) return {};
  const { rows } = await pool.query("SELECT data FROM settings WHERE id = 4");
  return rows[0]?.data || {};
}

export async function saveSchemaDesc(obj) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO settings (id, data, updated_at) VALUES (4, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [JSON.stringify(obj)]
  );
}

// Round-composition + generation config (TQ-364) lives in the settings table under id 5.
// {} when no DB or none saved.
export async function loadGenConfig() {
  if (!pool) return {};
  const { rows } = await pool.query("SELECT data FROM settings WHERE id = 5");
  return rows[0]?.data || {};
}

export async function saveGenConfig(obj) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO settings (id, data, updated_at) VALUES (5, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [JSON.stringify(obj)]
  );
}

// Rotating round-biome order (TQ-365) lives in the settings table under id 6, so the stable round
// set survives restarts. {} when no DB or none saved (→ world seeds a fresh ring on first round).
export async function loadRoundBiomes() {
  if (!pool) return {};
  const { rows } = await pool.query("SELECT data FROM settings WHERE id = 6");
  return rows[0]?.data || {};
}

export async function saveRoundBiomes(obj) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO settings (id, data, updated_at) VALUES (6, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [JSON.stringify(obj)]
  );
}

// Per-time generation schedule + last-run timestamps (TQ-369) live in the settings table under
// id 7. {} when no DB or none saved.
export async function loadGenSchedule() {
  if (!pool) return {};
  const { rows } = await pool.query("SELECT data FROM settings WHERE id = 7");
  return rows[0]?.data || {};
}

export async function saveGenSchedule(obj) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO settings (id, data, updated_at) VALUES (7, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [JSON.stringify(obj)]
  );
}

// All AI-generated monster types (P5). Empty when no DB.
export async function loadMonsterTypes() {
  if (!pool) return [];
  const { rows } = await pool.query("SELECT data FROM monster_types");
  return rows.map((r) => r.data);
}

// Delete a generated monster type. Returns true if a row was removed (i.e. it was
// a generated type, not a hand-authored one) — guards admin curation (P7-T3).
export async function deleteMonsterType(name) {
  if (!pool || !name) return false;
  const { rowCount } = await pool.query("DELETE FROM monster_types WHERE name = $1", [name]);
  return rowCount > 0;
}

// Persist one generated monster type (idempotent on its name).
export async function upsertMonsterType(mt) {
  if (!pool || !mt?.typeName) return;
  await pool.query(
    `INSERT INTO monster_types (name, data) VALUES ($1, $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data`,
    [mt.typeName, JSON.stringify(mt)]
  );
}

// AI-generated items (plan "Decide general items") — mirrors the monster-type persistence.
export async function loadItems() {
  if (!pool) return [];
  const { rows } = await pool.query("SELECT data FROM generated_items");
  return rows.map((r) => r.data);
}
export async function upsertItem(item) {
  if (!pool || !item?.name) return;
  await pool.query(
    `INSERT INTO generated_items (name, data) VALUES ($1, $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data`,
    [item.name, JSON.stringify(item)]
  );
}
export async function deleteItem(name) {
  if (!pool || !name) return false;
  const { rowCount } = await pool.query("DELETE FROM generated_items WHERE name = $1", [name]);
  return rowCount > 0;
}

// AI-generated floor tiles (analogous to items/monster types) — keyed by name.
export async function loadGroundTiles() {
  if (!pool) return [];
  const { rows } = await pool.query("SELECT data FROM generated_ground_tiles");
  return rows.map((r) => r.data);
}
export async function upsertGroundTile(tile) {
  if (!pool || !tile?.name) return;
  await pool.query(
    `INSERT INTO generated_ground_tiles (name, data) VALUES ($1, $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data`,
    [tile.name, JSON.stringify(tile)]
  );
}
export async function deleteGroundTile(name) {
  if (!pool || !name) return false;
  const { rowCount } = await pool.query("DELETE FROM generated_ground_tiles WHERE name = $1", [name]);
  return rowCount > 0;
}

// AI-generated biomes — keyed by name.
export async function loadBiomes() {
  if (!pool) return [];
  const { rows } = await pool.query("SELECT data FROM generated_biomes");
  return rows.map((r) => r.data);
}
export async function upsertBiome(biome) {
  if (!pool || !biome?.name) return;
  await pool.query(
    `INSERT INTO generated_biomes (name, data) VALUES ($1, $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data`,
    [biome.name, JSON.stringify(biome)]
  );
}
export async function deleteBiome(name) {
  if (!pool || !name) return false;
  const { rowCount } = await pool.query("DELETE FROM generated_biomes WHERE name = $1", [name]);
  return rowCount > 0;
}

// Bulk wipes (admin "clean wipe"). Each returns the number of rows deleted (0 without a DB).
// Destructive + irreversible — gated behind ADMIN_TOKEN in admin.js.
export async function wipeMonsterTypes() {
  if (!pool) return 0;
  const { rowCount } = await pool.query("DELETE FROM monster_types");
  return rowCount || 0;
}
export async function wipeItems() {
  if (!pool) return 0;
  const { rowCount } = await pool.query("DELETE FROM generated_items");
  return rowCount || 0;
}
export async function wipeGroundTiles() {
  if (!pool) return 0;
  const { rowCount } = await pool.query("DELETE FROM generated_ground_tiles");
  return rowCount || 0;
}
export async function wipeBiomes() {
  if (!pool) return 0;
  const { rowCount } = await pool.query("DELETE FROM generated_biomes");
  return rowCount || 0;
}
export async function wipeProfiles() {
  if (!pool) return 0;
  const { rowCount } = await pool.query("DELETE FROM profiles");
  return rowCount || 0;
}
export async function wipeAccounts() {
  if (!pool) return 0;
  const { rowCount } = await pool.query("DELETE FROM accounts");
  return rowCount || 0;
}

// Delete a single profile row (used when an account deletes one of its characters).
export async function deleteProfileRow(token) {
  if (!pool || !token) return false;
  const { rowCount } = await pool.query("DELETE FROM profiles WHERE token = $1", [token]);
  return rowCount > 0;
}

// Delete a single account row (used when a user permanently deletes their account, TQ-11).
export async function deleteAccountRow(sessionToken) {
  if (!pool || !sessionToken) return false;
  const { rowCount } = await pool.query("DELETE FROM accounts WHERE session_token = $1", [sessionToken]);
  return rowCount > 0;
}

// --- accounts persistence (cloud saves) — mirrors the profile upsert/load pattern ---
export async function loadAllAccounts() {
  if (!pool) return [];
  const { rows } = await pool.query("SELECT session_token, data FROM accounts");
  return rows.map((r) => ({ sessionToken: r.session_token, data: r.data }));
}
export async function upsertAccounts(accts) {
  if (!pool || accts.length === 0) return;
  const values = [];
  const tuples = accts.map((a, i) => {
    const b = i * 3;
    values.push(a.sessionToken, a.id, JSON.stringify(a));
    return `($${b + 1}, $${b + 2}, $${b + 3}::jsonb, now())`;
  });
  await pool.query(
    `INSERT INTO accounts (session_token, id, data, updated_at) VALUES ${tuples.join(", ")}
     ON CONFLICT (session_token) DO UPDATE SET data = EXCLUDED.data, id = EXCLUDED.id, updated_at = now()`,
    values
  );
}

// All persisted profiles, as { token, data } rows. Empty when no DB.
export async function loadAllProfiles() {
  if (!pool) return [];
  const { rows } = await pool.query("SELECT token, data FROM profiles");
  return rows.map((r) => ({ token: r.token, data: r.data }));
}

// Multi-row last-write-wins upsert. `profiles` are full PlayerProfile objects
// (each carries .token and .id). No-op without a DB or with an empty batch.
export async function upsertProfiles(profiles) {
  if (!pool || profiles.length === 0) return;
  const values = [];
  const tuples = profiles.map((p, i) => {
    const b = i * 3;
    values.push(p.token, p.id, JSON.stringify(p));
    return `($${b + 1}, $${b + 2}, $${b + 3}::jsonb, now())`;
  });
  await pool.query(
    `INSERT INTO profiles (token, id, data, updated_at) VALUES ${tuples.join(", ")}
     ON CONFLICT (token) DO UPDATE
       SET data = EXCLUDED.data, id = EXCLUDED.id, updated_at = now()`,
    values
  );
}

export async function closeDb() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}
