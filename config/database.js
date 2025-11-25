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
  max: 20, // nombre maximum de clients dans le pool
  idleTimeoutMillis: 30000, // fermer les clients inactifs après 30s
  connectionTimeoutMillis: 10000, // timeout de connexion de 10s
  acquireTimeoutMillis: 10000, // timeout d'acquisition de 10s
  // Réessayer en cas d'erreur de connexion
  retry: {
    max: 3,
    timeout: 1000
  }
});

// Gestion robuste des erreurs de connexion
pool.on('error', (err, client) => {
  console.error('Erreur inattendue sur le client PostgreSQL:', err);
  // Ne pas arrêter l'application en cas d'erreur de connexion
});

// Fonction de test de connexion avec reconnexion
const testConnection = async () => {
  let client;
  try {
    client = await pool.connect();
    console.log('✅ Connecté à la base PostgreSQL (Neon)');
    
    // Test simple de requête
    const result = await client.query('SELECT NOW() as current_time');
    console.log('📊 Test de requête réussi:', result.rows[0].current_time);
    
    return true;
  } catch (error) {
    console.error('❌ Erreur de connexion PostgreSQL:', error.message);
    
    // Tentative de reconnexion après délai
    setTimeout(() => {
      console.log('🔄 Tentative de reconnexion...');
      testConnection();
    }, 5000);
    
    return false;
  } finally {
    if (client) client.release();
  }
};

// Middleware pour gérer les erreurs de connexion dans les routes
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