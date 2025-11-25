const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { Pool } = require('pg');

const JSON_PATH = path.join(__dirname, 'toliara-I-fokontany-exclusif.json');

function stripComments(raw) {
  return raw.replace(/\/\/.*$/mg, '');
}

function computeCentroid(geom) {
  if (!geom || !geom.coordinates) return null;
  let coords = geom.coordinates;
  if (geom.type === 'MultiPolygon' && Array.isArray(coords) && coords[0]) coords = coords[0];
  const ring = Array.isArray(coords[0]) ? coords[0] : coords;
  let sumX = 0, sumY = 0, count = 0;
  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const lng = parseFloat(p[0]), lat = parseFloat(p[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    sumX += lng; sumY += lat; count++;
  }
  if (count === 0) return null;
  return { lat: sumY / count, lng: sumX / count };
}

(async () => {
  const pool = new Pool({
    connectionString: process.env.DB_URL,
    ssl: { rejectUnauthorized: false }
  });

  let raw = fs.readFileSync(JSON_PATH, 'utf8');
  let geo;
  try { geo = JSON.parse(raw); }
  catch (e) { geo = JSON.parse(stripComments(raw)); }

  if (!geo.features || !Array.isArray(geo.features)) {
    console.error('Fichier invalide : pas de features'); await pool.end(); process.exit(1);
  }

  try {
    // Clear table
    await pool.query('TRUNCATE TABLE fokontany RESTART IDENTITY CASCADE;');

    const insertSql = `
      INSERT INTO fokontany
        (code, nom, commune, district, region, geometry_type, coordinates, centre_lat, centre_lng, type, source, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW())
      ON CONFLICT (code) DO UPDATE SET
        nom = EXCLUDED.nom,
        commune = EXCLUDED.commune,
        district = EXCLUDED.district,
        region = EXCLUDED.region,
        geometry_type = EXCLUDED.geometry_type,
        coordinates = EXCLUDED.coordinates,
        centre_lat = EXCLUDED.centre_lat,
        centre_lng = EXCLUDED.centre_lng,
        type = EXCLUDED.type,
        source = EXCLUDED.source,
        updated_at = NOW();
    `;

    let inserted = 0, skipped = 0;
    for (let i = 0; i < geo.features.length; i++) {
      const f = geo.features[i];
      if (!f || f.type !== 'Feature') { skipped++; continue; }
      const props = f.properties || {};
      const code = String(props.shapeID || props.id || props.shapeName || props.name || `auto_${i}`);
      const nom = props.name || props.shapeName || null;
      const region = geo.metadata?.region || props.region || null;
      const commune = props.commune || props.commune_name || region || '';
      const district = props.district || props.district_name || '';
      const geometry_type = f.geometry?.type || null;
      const coordsString = f.geometry ? JSON.stringify(f.geometry.coordinates) : null;
      const centre = computeCentroid(f.geometry || {});
      const centre_lat = centre?.lat ?? (props.centre_lat ? parseFloat(props.centre_lat) : null);
      const centre_lng = centre?.lng ?? (props.centre_lng ? parseFloat(props.centre_lng) : null);
      const type = 'fokontany';
      const source = geo.metadata?.source || path.basename(JSON_PATH);

      try {
        await pool.query(insertSql, [code, nom, commune, district, region, geometry_type, coordsString, centre_lat, centre_lng, type, source]);
        inserted++;
      } catch (err) {
        console.warn('Insertion échouée index', i, err.message);
        skipped++;
      }
    }

    console.log(`Opération terminée. ${inserted} insérés/MAJ, ${skipped} ignorés.`);
  } catch (err) {
    console.error('Erreur durant l\'opération :', err.message);
  } finally {
    await pool.end();
  }
})();
