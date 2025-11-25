const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

async function importGeoJSON(filePath) {
  const abs = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  if (!fs.existsSync(abs)) {
    console.error('Fichier introuvable:', abs);
    process.exit(1);
  }
  const raw = fs.readFileSync(abs, 'utf8');
  const geo = JSON.parse(raw);
  if (!geo.features || !Array.isArray(geo.features)) {
    console.error('GeoJSON invalide');
    process.exit(1);
  }

  let inserted = 0;
  for (const f of geo.features) {
    try {
      const props = f.properties || {};
      const code = props.code || props.id || props.COD_FKT || null;
      const nom = props.nom || props.name || props.NOM || 'Unnamed';
      const commune = props.commune || props.COMMUNE || null;
      const district = props.district || props.DISTRICT || null;
      const region = props.region || props.REGION || null;
      const geometry_type = f.geometry ? f.geometry.type : null;
      const coordinates = f.geometry ? JSON.stringify(f.geometry.coordinates) : null;
      // optional centre computed from geometry properties or props
      const centre_lat = props.centre_lat || props.lat || null;
      const centre_lng = props.centre_lng || props.lng || null;
      const type = props.type || 'fokontany';
      const source = props.source || path.basename(filePath);

      const q = `
        INSERT INTO fokontany (code, nom, commune, district, region, geometry_type, coordinates, centre_lat, centre_lng, type, source, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
        ON CONFLICT (code) DO NOTHING
      `;
      await pool.query(q, [code || `${nom}-${inserted}`, nom, commune, district, region, geometry_type, coordinates, centre_lat, centre_lng, type, source]);
      inserted++;
    } catch (err) {
      console.warn('Erreur insert feature', err);
    }
  }

  console.log(`Import terminé. Features traitées: ${geo.features.length}, insérées (approx): ${inserted}`);
  process.exit(0);
}

const fileArg = process.argv[2] || 'data/fokontany.geojson';
importGeoJSON(fileArg).catch(err => {
  console.error('Import échoué', err);
  process.exit(1);
});