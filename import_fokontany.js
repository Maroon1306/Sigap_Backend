const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Pool } = require('pg');

const JSON_PATH = path.join(__dirname, 'toliara-I-fokontany-exclusif.json');

function stripComments(raw) {
  return raw.replace(/\/\/.*$/mg, '');
}

function validFeature(f) {
  if (!f || f.type !== 'Feature') return false;
  const p = f.properties || {};
  if (!p.id && !p.shapeID && !p.name) return false;
  if (!f.geometry || !f.geometry.type) return false;
  const c = f.geometry.coordinates;
  if (!Array.isArray(c) || c.length === 0) return false;
  return true;
}

(async () => {
  const pool = new Pool({
    connectionString: process.env.DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS fokontany (
      id TEXT PRIMARY KEY,
      name TEXT,
      shapeName TEXT,
      shapeID TEXT,
      shapeGroup TEXT,
      shapeType TEXT,
      properties JSONB,
      geometry JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const raw = fs.readFileSync(JSON_PATH, 'utf8');
  let geo;
  try { geo = JSON.parse(raw); }
  catch (e) { geo = JSON.parse(stripComments(raw)); }

  if (!geo.features || !Array.isArray(geo.features)) {
    console.error('Fichier invalide : pas de features'); process.exit(1);
  }

  const insertSql = `
    INSERT INTO fokontany
      (id,name,shapeName,shapeID,shapeGroup,shapeType,properties,geometry)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      shapeName = EXCLUDED.shapeName,
      shapeID = EXCLUDED.shapeID,
      shapeGroup = EXCLUDED.shapeGroup,
      shapeType = EXCLUDED.shapeType,
      properties = EXCLUDED.properties,
      geometry = EXCLUDED.geometry;
  `;

  let n = 0;
  for (const f of geo.features) {
    if (!validFeature(f)) continue;
    const props = f.properties || {};
    const id = props.id || props.shapeID || props.name;
    if (!id) continue;
    const name = props.name || null;
    const shapeName = props.shapeName || null;
    const shapeID = props.shapeID || null;
    const shapeGroup = props.shapeGroup || null;
    const shapeType = props.shapeType || null;
    const propsJson = JSON.stringify(props);
    const geomJson = JSON.stringify(f.geometry || null);
    await pool.query(insertSql, [id, name, shapeName, shapeID, shapeGroup, shapeType, propsJson, geomJson]);
    n++;
  }

  console.log('Import terminé:', n, 'features insérées/MAJ');
  await pool.end();
})();