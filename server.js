const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');
const seedPath = path.join(__dirname, 'data_projects_dpcd.json');
const adminToken = normalizeSecret(process.env.ADMIN_TOKEN || '');

let pool;
let initPromise;

app.use(express.json({ limit: '8mb' }));
app.use(express.static(publicDir));

app.get('/api/health', async (_req, res) => {
  const health = {
    ok: true,
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    databaseConnected: false,
    authEnabled: Boolean(adminToken)
  };

  if (process.env.DATABASE_URL) {
    try {
      await getPool().query('SELECT 1');
      health.databaseConnected = true;
    } catch (err) {
      health.ok = false;
      health.databaseError = sanitizeDatabaseError(err);
    }
  }

  res.status(health.ok ? 200 : 503).json(health);
});

app.get('/api/state', async (_req, res, next) => {
  try {
    const state = await getDashboardState();
    res.json({
      data: state.data,
      updatedAt: state.updated_at,
      updatedBy: state.updated_by || ''
    });
  } catch (err) {
    next(err);
  }
});

app.put('/api/state', requireAdminToken, async (req, res, next) => {
  try {
    const data = req.body;
    const savedBy = sanitizeEditorName(req.get('x-editor-name') || '');
    validateDashboardState(data);
    const state = await saveDashboardState(data, savedBy);
    res.json({
      data: state.data,
      updatedAt: state.updated_at,
      updatedBy: state.updated_by || ''
    });
  } catch (err) {
    next(err);
  }
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API route tidak ditemukan.' });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  const message = status >= 500 && !err.expose ? 'Server error' : err.message;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

app.listen(port, () => {
  console.log(`DPCD dashboard listening on port ${port}`);
  if (!process.env.DATABASE_URL) {
    console.warn('DATABASE_URL is not set. /api/state will fail until PostgreSQL is configured.');
  }
  if (!adminToken) {
    console.warn('ADMIN_TOKEN is not set. Writes to /api/state are currently open.');
  }
});

function getPool() {
  if (!process.env.DATABASE_URL) {
    const err = new Error('DATABASE_URL belum dikonfigurasi.');
    err.status = 503;
    err.expose = true;
    throw err;
  }
  if (!pool) {
    const sslEnabled = process.env.PGSSL === 'true' || process.env.PGSSLMODE === 'require';
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslEnabled ? { rejectUnauthorized: false } : undefined
    });
  }
  return pool;
}

async function initDatabase() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS dashboard_state (
      id integer PRIMARY KEY CHECK (id = 1),
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by text NOT NULL DEFAULT ''
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS dashboard_revisions (
      id bigserial PRIMARY KEY,
      data jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      saved_by text NOT NULL DEFAULT ''
    )
  `);
  await db.query(`ALTER TABLE dashboard_state ADD COLUMN IF NOT EXISTS updated_by text NOT NULL DEFAULT ''`);
  await db.query(`ALTER TABLE dashboard_revisions ADD COLUMN IF NOT EXISTS saved_by text NOT NULL DEFAULT ''`);

  const existing = await db.query('SELECT id FROM dashboard_state WHERE id = 1');
  if (existing.rowCount === 0) {
    const seed = await readSeedState();
    validateDashboardState(seed);
    await db.query(
      'INSERT INTO dashboard_state (id, data, updated_by) VALUES (1, $1::jsonb, $2)',
      [JSON.stringify(seed), 'seed']
    );
    await db.query(
      'INSERT INTO dashboard_revisions (data, saved_by) VALUES ($1::jsonb, $2)',
      [JSON.stringify(seed), 'seed']
    );
  }
}

async function ensureDatabase() {
  if (!initPromise) {
    initPromise = initDatabase().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

async function getDashboardState() {
  await ensureDatabase();
  const result = await getPool().query('SELECT data, updated_at, updated_by FROM dashboard_state WHERE id = 1');
  if (result.rowCount === 0) {
    const err = new Error('Data dashboard belum tersedia.');
    err.status = 404;
    throw err;
  }
  return result.rows[0];
}

async function saveDashboardState(data, savedBy) {
  await ensureDatabase();
  const db = getPool();
  const payload = JSON.stringify(data);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO dashboard_revisions (data, saved_by) VALUES ($1::jsonb, $2)', [payload, savedBy]);
    const result = await client.query(
      `INSERT INTO dashboard_state (id, data, updated_at, updated_by)
       VALUES (1, $1::jsonb, now(), $2)
       ON CONFLICT (id)
       DO UPDATE SET data = EXCLUDED.data, updated_at = now(), updated_by = EXCLUDED.updated_by
       RETURNING data, updated_at, updated_by`,
      [payload, savedBy]
    );
    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function readSeedState() {
  const raw = await fs.readFile(seedPath, 'utf8');
  return JSON.parse(raw);
}

function validateDashboardState(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    const err = new Error('Payload harus berupa object dashboard.');
    err.status = 400;
    throw err;
  }
  if (!data.meta || typeof data.meta !== 'object') {
    const err = new Error('Payload dashboard harus memiliki meta.');
    err.status = 400;
    throw err;
  }
  if (!Array.isArray(data.projects)) {
    const err = new Error('Payload dashboard harus memiliki projects array.');
    err.status = 400;
    throw err;
  }
}

function requireAdminToken(req, res, next) {
  if (!adminToken) return next();
  const header = req.get('x-admin-token') || '';
  const bearer = req.get('authorization') || '';
  const token = normalizeSecret(header || bearer.replace(/^Bearer\s+/i, ''));
  if (token === adminToken) return next();
  res.status(401).json({ error: 'ADMIN_TOKEN tidak valid.' });
}

function normalizeSecret(value) {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

function sanitizeEditorName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 100) || 'unknown';
}

function sanitizeDatabaseError(err) {
  return String(err && err.message ? err.message : err)
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://***@')
    .replace(/password=[^&\s]+/gi, 'password=***');
}
