const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: { rejectUnauthorized: false } // Nécessaire pour Neon
});

// Test de connexion
pool.connect((err, client, release) => {
  if (err) {
    console.error('Erreur de connexion à la base PostgreSQL:', err.stack);
  } else {
    console.log('✅ Connecté à la base PostgreSQL (Neon)');
    release();
  }
});

module.exports = { pool };