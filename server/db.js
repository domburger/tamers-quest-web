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
