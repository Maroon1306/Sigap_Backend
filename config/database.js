const { Pool } = require('pg');
require('dotenv').config();

// Configuration optimisée pour Neon
const pool = new Pool({
  connectionString: process.env.DB_URL,
  ssl: {
    rejectUnauthorized: false,
    require: true
  },
  // Paramètres de connexion optimisés
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  acquireTimeoutMillis: 10000
});

// Gestion robuste des erreurs de connexion
pool.on('error', (err, client) => {
  console.error('Erreur inattendue sur le client PostgreSQL:', err);
});

// Fonction de test de connexion
const testConnection = async () => {
  let client;
  try {
    client = await pool.connect();
    console.log('✅ Connecté à la base PostgreSQL (Neon)');
    
    const result = await client.query('SELECT NOW() as current_time');
    console.log('📊 Test de requête réussi:', result.rows[0].current_time);
    
    return true;
  } catch (error) {
    console.error('❌ Erreur de connexion PostgreSQL:', error.message);
    return false;
  } finally {
    if (client) client.release();
  }
};

// Middleware pour gérer les erreurs de connexion
const handleDBError = (error, res) => {
  console.error('Erreur base de données:', error);
  
  if (error.code === '57P01' || error.message.includes('terminated') || error.message.includes('ECONNRESET')) {
    return res.status(503).json({ 
      message: 'Service temporairement indisponible. Reconnexion en cours...',
      error: 'DATABASE_CONNECTION_ERROR'
    });
  }
  
  return res.status(500).json({ 
    message: 'Erreur serveur de base de données',
    error: error.message 
  });
};

module.exports = { 
  pool, 
  testConnection,
  handleDBError 
};