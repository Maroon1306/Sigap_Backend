const { pool } = require('../config/database');

class FokontanyController {
  static async getAllFokontany(req, res) {
    try {
      const query = `
        SELECT id, code, nom, commune, district, region,
               geometry_type, coordinates, centre_lat, centre_lng,
               type, source
        FROM fokontany
        ORDER BY region, district, commune, nom
      `;
      const result = await pool.query(query);
      const fokontany = result.rows.map(fkt => {
        let coords = fkt.coordinates;
        try {
          if (coords && typeof coords === 'string') coords = JSON.parse(coords);
        } catch (e) { /* keep as is */ }
        return { ...fkt, coordinates: coords };
      });
      res.json(fokontany);
    } catch (error) {
      console.error('Erreur récupération fokontany:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async getFokontanyByRegion(req, res) {
    try {
      const { region } = req.params;
      const query = `
        SELECT id, code, nom, commune, district, region,
               geometry_type, coordinates, centre_lat, centre_lng,
               type, source
        FROM fokontany
        WHERE region = $1
        ORDER BY district, commune, nom
      `;
      const result = await pool.query(query, [region]);
      const fokontany = result.rows.map(fkt => {
        let coords = fkt.coordinates;
        try {
          if (coords && typeof coords === 'string') coords = JSON.parse(coords);
        } catch (e) {}
        return { ...fkt, coordinates: coords };
      });
      res.json(fokontany);
    } catch (error) {
      console.error('Erreur récupération fokontany par région:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async getFokontanyByUserLocation(req, res) {
    try {
      const { lat, lng } = req.query;
      if (!lat || !lng) return res.status(400).json({ message: 'Latitude et longitude requises' });

      // Postgres: compute simple distance using pow difference (not geospatial accurate)
      const query = `
        SELECT id, code, nom, commune, district, region,
               geometry_type, coordinates, centre_lat, centre_lng,
               type, source,
               sqrt( pow((centre_lat::double precision) - $1, 2) + pow((centre_lng::double precision) - $2, 2) ) as distance
        FROM fokontany
        WHERE centre_lat IS NOT NULL AND centre_lng IS NOT NULL
        ORDER BY distance
        LIMIT 1
      `;
      const result = await pool.query(query, [parseFloat(lat), parseFloat(lng)]);
      if (result.rows.length > 0) {
        const f = result.rows[0];
        let coords = f.coordinates;
        try { if (coords && typeof coords === 'string') coords = JSON.parse(coords); } catch (e) {}
        res.json({ ...f, coordinates: coords });
      } else {
        res.status(404).json({ message: 'Aucun fokontany trouvé' });
      }
    } catch (error) {
      console.error('Erreur recherche fokontany:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async searchFokontany(req, res) {
    try {
      const { query } = req.query;
      if (!query) return res.status(400).json({ message: 'Terme de recherche requis' });

      const sql = `
        SELECT id, code, nom, commune, district, region,
               geometry_type, coordinates, centre_lat, centre_lng,
               type, source
        FROM fokontany
        WHERE nom ILIKE $1 OR commune ILIKE $1 OR district ILIKE $1
        ORDER BY region, district, commune, nom
        LIMIT 20
      `;
      const term = `%${query}%`;
      const result = await pool.query(sql, [term]);
      const fokontany = result.rows.map(fkt => {
        let coords = fkt.coordinates;
        try { if (coords && typeof coords === 'string') coords = JSON.parse(coords); } catch (e) {}
        return { ...fkt, coordinates: coords };
      });
      res.json(fokontany);
    } catch (error) {
      console.error('Erreur recherche fokontany:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // createTestFokontany (same behavior, inserts JSON coordinates)
  static async createTestFokontany(req, res) {
    try {
      const checkQuery = `SELECT COUNT(*) AS count FROM fokontany`;
      const countRes = await pool.query(checkQuery);
      const count = parseInt(countRes.rows[0].count, 10);
      if (count > 0) return res.json({ message: 'Données déjà existantes', count });

      const testFokontany = [
        {
          code: 'ANALAKELY_001',
          nom: 'Analakely',
          commune: 'Antananarivo Renivohitra',
          district: 'Antananarivo Renivohitra',
          region: 'Analamanga',
          geometry_type: 'Polygon',
          coordinates: JSON.stringify([[
            [47.520, -18.910],
            [47.530, -18.910],
            [47.530, -18.900],
            [47.520, -18.900],
            [47.520, -18.910]
          ]]),
          centre_lat: -18.905,
          centre_lng: 47.525,
          type: 'fokontany',
          source: 'test'
        },
        // ... autres tests (Isoraka, Anosy, etc.)
      ];

      let created = 0;
      for (const f of testFokontany) {
        try {
          const q = `
            INSERT INTO fokontany (code, nom, commune, district, region, geometry_type, coordinates, centre_lat, centre_lng, type, source)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
            ON CONFLICT (code) DO NOTHING
          `;
          await pool.query(q, [f.code, f.nom, f.commune, f.district, f.region, f.geometry_type, f.coordinates, f.centre_lat, f.centre_lng, f.type, f.source]);
          created++;
        } catch (err) {
          console.warn('Erreur insert test fokontany', err);
        }
      }

      res.json({ message: 'Fokontany de test créés avec succès', created, total: testFokontany.length });
    } catch (error) {
      console.error('Erreur createTestFokontany:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async getMyFokontany(req, res) {
    try {
      const user = req.user;
      if (!user || !user.fokontany_id) return res.status(404).json({ message: 'Aucun fokontany associé à cet utilisateur' });

      const query = `
        SELECT id, code, nom, commune, district, region,
               geometry_type, coordinates, centre_lat, centre_lng,
               type, source
        FROM fokontany
        WHERE id = $1
        LIMIT 1
      `;
      const result = await pool.query(query, [user.fokontany_id]);
      if (!result.rows.length) return res.status(404).json({ message: 'Fokontany introuvable' });
      const f = result.rows[0];
      try { if (f.coordinates && typeof f.coordinates === 'string') f.coordinates = JSON.parse(f.coordinates); } catch (e) {}
      res.json(f);
    } catch (error) {
      console.error('Erreur getMyFokontany:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }
}

module.exports = FokontanyController;