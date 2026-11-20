let pool = null;

export function dbEnabled() {
  return pool !== null;
}

export async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  try {
    const pg = (await import("pg")).default;
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS monster_types (
        name       TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS generated_items (
        name       TEXT PRIMARY KEY,
        data       JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id         INT PRIMARY KEY,
        data       JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
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

export async function loadMarketListings() {
  if (!pool) return [];
  const { rows } = await pool.query("SELECT data FROM settings WHERE id = 8");
  const data = rows[0]?.data;
  return Array.isArray(data) ? data : [];
}

export async function saveMarketListings(listings) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO settings (id, data, updated_at) VALUES (8, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [JSON.stringify(Array.isArray(listings) ? listings : [])]
  );
}

export async function loadEvolvedTypes() {
  if (!pool) return [];
  const { rows } = await pool.query("SELECT data FROM settings WHERE id = 9");
  const data = rows[0]?.data;
  return Array.isArray(data) ? data : [];
}

export async function saveEvolvedTypes(types) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO settings (id, data, updated_at) VALUES (9, $1::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [JSON.stringify(Array.isArray(types) ? types : [])]
  );
}

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

export async function loadMonsterTypes() {
  if (!pool) return [];
  const { rows } = await pool.query("SELECT data FROM monster_types");
  return rows.map((r) => r.data);
}

export async function deleteMonsterType(name) {
  if (!pool || !name) return false;
  const { rowCount } = await pool.query("DELETE FROM monster_types WHERE name = $1", [name]);
  return rowCount > 0;
}

export async function upsertMonsterType(mt) {
  if (!pool || !mt?.typeName) return;
  await pool.query(
    `INSERT INTO monster_types (name, data) VALUES ($1, $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data`,
    [mt.typeName, JSON.stringify(mt)]
  );
}

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

export async function deleteProfileRow(token) {
  if (!pool || !token) return false;
  const { rowCount } = await pool.query("DELETE FROM profiles WHERE token = $1", [token]);
  return rowCount > 0;
}

export async function deleteAccountRow(sessionToken) {
  if (!pool || !sessionToken) return false;
  const { rowCount } = await pool.query("DELETE FROM accounts WHERE session_token = $1", [sessionToken]);
  return rowCount > 0;
}

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

export async function loadAllProfiles() {
  if (!pool) return [];
  const { rows } = await pool.query("SELECT token, data FROM profiles");
  return rows.map((r) => ({ token: r.token, data: r.data }));
}

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
