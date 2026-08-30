const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json({ limit: '80mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

const KEYS = ['library', 'services', 'proposals'];
const SECRET = process.env.SHARED_SECRET || '';

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shap_state (
      key TEXT PRIMARY KEY,
      html TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  for (const k of KEYS) {
    await pool.query(
      `INSERT INTO shap_state (key, html) VALUES ($1, '') ON CONFLICT (key) DO NOTHING`,
      [k]
    );
  }
  console.log('DB ready');
}

init().catch((err) => {
  console.error('DB init failed', err);
  process.exit(1);
});

function checkAuth(req, res, next) {
  if (!SECRET) return next();
  if (req.get('X-Shap-Secret') !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.get('/', (req, res) => {
  res.send('SHAP proposal backend is running');
});

app.get('/api/state', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT key, html, updated_at FROM shap_state');
    const out = { library: '', services: '', proposals: '', updatedAt: {} };
    for (const r of rows) {
      out[r.key] = r.html;
      out.updatedAt[r.key] = r.updated_at;
    }
    res.json(out);
  } catch (e) {
    console.error('GET /api/state failed', e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.post('/api/state', checkAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const entries = KEYS.filter((k) => typeof body[k] === 'string');
    if (!entries.length) {
      return res.status(400).json({ error: 'no_valid_keys' });
    }
    for (const key of entries) {
      await pool.query(
        `INSERT INTO shap_state (key, html, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET html = EXCLUDED.html, updated_at = now()`,
        [key, body[key]]
      );
    }
    res.json({ ok: true, saved: entries });
  } catch (e) {
    console.error('POST /api/state failed', e);
    res.status(500).json({ error: 'server_error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('shap-proposal-backend listening on', PORT));
