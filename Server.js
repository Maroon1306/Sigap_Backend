const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const { pool, testConnection, handleDBError } = require('./config/database');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const residencesRoutes = require('./routes/residences');
const fokontanyRoutes = require('./routes/fokontany');
const personsRoutes = require('./routes/persons');

const auth = require('./middleware/auth');
const NotificationController = require('./controllers/notificationController');
const { ResidenceController } = require('./controllers/residenceController');

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Créer les dossiers d'upload
const uploadsDir = path.join(__dirname, 'uploads');
const residencesUploadDir = path.join(uploadsDir, 'residences');
const pendingUploadDir = path.join(uploadsDir, 'pending_residences');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(residencesUploadDir)) fs.mkdirSync(residencesUploadDir, { recursive: true });
if (!fs.existsSync(pendingUploadDir)) fs.mkdirSync(pendingUploadDir, { recursive: true });

// Tester la connexion au démarrage
let isDBConnected = false;

const initializeServer = async () => {
  console.log('🔄 Initialisation de la connexion PostgreSQL...');
  isDBConnected = await testConnection();
  
  if (isDBConnected) {
    startServer();
  } else {
    console.log('⏳ Nouvelle tentative de connexion dans 10 secondes...');
    setTimeout(initializeServer, 10000);
  }
};

const startServer = () => {
  // Routes principales avec gestion d'erreurs
  app.use('/api/auth', (req, res, next) => {
    if (!isDBConnected) {
      return res.status(503).json({ 
        message: 'Service temporairement indisponible. Base de données en cours de connexion...' 
      });
    }
    next();
  }, authRoutes);

  app.use('/api/users', (req, res, next) => {
    if (!isDBConnected) {
      return res.status(503).json({ 
        message: 'Service temporairement indisponible. Base de données en cours de connexion...' 
      });
    }
    next();
  }, userRoutes);

  app.use('/api/residences', (req, res, next) => {
    if (!isDBConnected) {
      return res.status(503).json({ 
        message: 'Service temporairement indisponible. Base de données en cours de connexion...' 
      });
    }
    next();
  }, residencesRoutes);

  app.use('/api/fokontany', (req, res, next) => {
    if (!isDBConnected) {
      return res.status(503).json({ 
        message: 'Service temporairement indisponible. Base de données en cours de connexion...' 
      });
    }
    next();
  }, fokontanyRoutes);

  app.use('/api/persons', (req, res, next) => {
    if (!isDBConnected) {
      return res.status(503).json({ 
        message: 'Service temporairement indisponible. Base de données en cours de connexion...' 
      });
    }
    next();
  }, personsRoutes);

  // Route de test avec vérification de la base de données
  app.get('/api/test', async (req, res) => {
    try {
      const result = await pool.query('SELECT NOW() as server_time, version() as pg_version');
      res.json({ 
        message: '✅ API SIGAP PostgreSQL fonctionnelle',
        database: {
          time: result.rows[0].server_time,
          version: result.rows[0].pg_version
        }
      });
    } catch (error) {
      handleDBError(error, res);
    }
  });

  // Health check simplifié
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'OK', 
      database: isDBConnected ? 'CONNECTED' : 'DISCONNECTED',
      timestamp: new Date().toISOString()
    });
  });

  // Route pour réparer les séquences PostgreSQL
  app.get('/api/fix-sequences', async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      console.log('🔧 Réparation des séquences PostgreSQL...');
      
      const tables = [
        'users', 'fokontany', 'residences', 'persons', 
        'photos', 'person_relations', 'notifications', 
        'pending_residences', 'password_reset_requests', 
        'password_change_requests'
      ];

      let results = [];
      
      for (const table of tables) {
        const sequenceName = `${table}_id_seq`;
        
        // Vérifier si la table existe
        const tableExists = await client.query(
          "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
          [table]
        );
        
        if (!tableExists.rows[0].exists) {
          results.push({
            table,
            sequence: sequenceName,
            status: 'skipped',
            reason: 'Table does not exist'
          });
          continue;
        }
        
        // Vérifier si la séquence existe
        const sequenceExists = await client.query(
          "SELECT EXISTS (SELECT FROM information_schema.sequences WHERE sequence_name = $1)",
          [sequenceName]
        );
        
        if (!sequenceExists.rows[0].exists) {
          results.push({
            table,
            sequence: sequenceName,
            status: 'skipped',
            reason: 'Sequence does not exist'
          });
          continue;
        }
        
        // Réinitialiser la séquence
        const fixQuery = `
          SELECT setval('${sequenceName}', COALESCE((SELECT MAX(id) FROM ${table}), 1), true) as new_value
        `;
        
        try {
          const result = await client.query(fixQuery);
          results.push({
            table,
            sequence: sequenceName,
            status: 'fixed',
            new_value: result.rows[0].new_value
          });
          console.log(`✅ ${table}: séquence réinitialisée à ${result.rows[0].new_value}`);
        } catch (error) {
          results.push({
            table,
            sequence: sequenceName,
            status: 'error',
            error: error.message
          });
        }
      }

      await client.query('COMMIT');
      
      res.json({
        message: 'Séquences réinitialisées avec succès',
        results
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erreur réinitialisation séquences:', error);
      res.status(500).json({ 
        error: 'Erreur lors de la réinitialisation des séquences',
        details: error.message 
      });
    } finally {
      client.release();
    }
  });

  // Routes pour les notifications
  app.get('/api/notifications', auth, async (req, res) => {
    try {
      await NotificationController.getUserNotifications(req, res);
    } catch (error) {
      res.status(500).json({ message: 'Erreur serveur' });
    }
  });

  app.get('/api/notifications/unread-count', auth, async (req, res) => {
    try {
      await NotificationController.getUnreadCount(req, res);
    } catch (error) {
      res.status(500).json({ message: 'Erreur serveur' });
    }
  });

  app.patch('/api/notifications/:notificationId/read', auth, async (req, res) => {
    try {
      await NotificationController.markAsRead(req, res);
    } catch (error) {
      res.status(500).json({ message: 'Erreur serveur' });
    }
  });

  // Routes pour l'approbation des résidences
  app.get('/api/residences/pending', auth, async (req, res) => {
    try {
      await ResidenceController.getPendingResidences(req, res);
    } catch (error) {
      res.status(500).json({ message: 'Erreur serveur' });
    }
  });

  app.post('/api/residences/pending/:pendingId/approve', auth, async (req, res) => {
    try {
      await ResidenceController.approveResidence(req, res);
    } catch (error) {
      res.status(500).json({ message: 'Erreur serveur' });
    }
  });

  app.post('/api/residences/pending/:pendingId/reject', auth, async (req, res) => {
    try {
      await ResidenceController.rejectResidence(req, res);
    } catch (error) {
      res.status(500).json({ message: 'Erreur serveur' });
    }
  });

  // Initialisation de la base de données avec gestion d'erreurs améliorée
  app.get('/api/init-db', async (req, res) => {
    if (!isDBConnected) {
      return res.status(503).json({ 
        message: 'Base de données non connectée. Veuillez réessayer.' 
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Table fokontany (créer d'abord car users y fait référence)
      await client.query(`
        CREATE TABLE IF NOT EXISTS fokontany (
          id SERIAL PRIMARY KEY,
          code VARCHAR(50) UNIQUE NOT NULL,
          nom VARCHAR(255) NOT NULL,
          commune VARCHAR(255),
          district VARCHAR(255),
          region VARCHAR(255),
          geometry_type VARCHAR(50),
          coordinates JSONB,
          centre_lat DECIMAL(10, 8),
          centre_lng DECIMAL(11, 8),
          type VARCHAR(50) DEFAULT 'fokontany',
          source VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Table users
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          immatricule VARCHAR(50) UNIQUE NOT NULL,
          nom_complet VARCHAR(255) NOT NULL,
          username VARCHAR(100) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL,
          role VARCHAR(20) CHECK (role IN ('admin', 'agent', 'secretaire')) DEFAULT 'agent',
          fokontany_id INTEGER REFERENCES fokontany(id) ON DELETE SET NULL,
          is_active BOOLEAN DEFAULT TRUE,
          photo VARCHAR(255),
          must_change_password BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Table residences
      await client.query(`
        CREATE TABLE IF NOT EXISTS residences (
          id SERIAL PRIMARY KEY,
          lot VARCHAR(255) NOT NULL,
          quartier VARCHAR(255),
          ville VARCHAR(255),
          fokontany VARCHAR(255),
          lat DOUBLE PRECISION,
          lng DOUBLE PRECISION,
          created_by INTEGER REFERENCES users(id),
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Table persons
      await client.query(`
        CREATE TABLE IF NOT EXISTS persons (
          id SERIAL PRIMARY KEY,
          residence_id INTEGER NOT NULL REFERENCES residences(id) ON DELETE CASCADE,
          nom_complet VARCHAR(255) NOT NULL,
          date_naissance DATE,
          cin VARCHAR(50),
          genre VARCHAR(10) CHECK (genre IN ('homme', 'femme', 'autre')) DEFAULT 'homme',
          telephone VARCHAR(50),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Table photos
      await client.query(`
        CREATE TABLE IF NOT EXISTS photos (
          id SERIAL PRIMARY KEY,
          residence_id INTEGER NOT NULL REFERENCES residences(id) ON DELETE CASCADE,
          filename VARCHAR(255) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Table person_relations
      await client.query(`
        CREATE TABLE IF NOT EXISTS person_relations (
          id SERIAL PRIMARY KEY,
          person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
          parent_id INTEGER REFERENCES persons(id) ON DELETE SET NULL,
          relation_type VARCHAR(191),
          is_proprietaire BOOLEAN DEFAULT FALSE,
          famille_id INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Table notifications
      await client.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id SERIAL PRIMARY KEY,
          type VARCHAR(50) NOT NULL,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          related_entity_id INTEGER,
          status VARCHAR(20) DEFAULT 'pending',
          is_read BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Table pending_residences
      await client.query(`
        CREATE TABLE IF NOT EXISTS pending_residences (
          id SERIAL PRIMARY KEY,
          residence_data JSONB NOT NULL,
          submitted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          status VARCHAR(20) DEFAULT 'pending',
          reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          review_notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Table password_reset_requests
      await client.query(`
        CREATE TABLE IF NOT EXISTS password_reset_requests (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          immatricule VARCHAR(50) NOT NULL,
          status VARCHAR(20) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Table password_change_requests
      await client.query(`
        CREATE TABLE IF NOT EXISTS password_change_requests (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          new_password_hash VARCHAR(255) NOT NULL,
          status VARCHAR(20) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Réinitialiser les séquences
      const sequences = [
        'users_id_seq', 'fokontany_id_seq', 'residences_id_seq', 'persons_id_seq',
        'photos_id_seq', 'person_relations_id_seq', 'notifications_id_seq',
        'pending_residences_id_seq', 'password_reset_requests_id_seq', 
        'password_change_requests_id_seq'
      ];

      for (const seq of sequences) {
        try {
          await client.query(`SELECT setval('${seq}', 1, false)`);
          console.log(`✅ Séquence ${seq} réinitialisée`);
        } catch (error) {
          console.log(`⚠️  Impossible de réinitialiser ${seq}: ${error.message}`);
        }
      }

      // Créer l'admin par défaut
      const bcrypt = require('bcryptjs');
      const defaultPassword = bcrypt.hashSync('admin1234', 10);
      
      await client.query(
        `INSERT INTO users (immatricule, nom_complet, username, password, role) 
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (username) DO NOTHING`,
        ['ADMIN001', 'Administrateur SIGAP', 'admin', defaultPassword, 'admin']
      );

      await client.query('COMMIT');

      res.json({ 
        message: 'Base de données PostgreSQL initialisée avec succès',
        admin: {
          username: 'admin',
          password: 'admin1234'
        }
      });
    } catch (error) {
      await client.query('ROLLBACK');
      handleDBError(error, res);
    } finally {
      client.release();
    }
  });

  // Servir les fichiers statiques
  app.use('/uploads', express.static(uploadsDir));

  // Gestion des erreurs 404
  app.use('*', (req, res) => {
    res.status(404).json({ message: 'Route non trouvée' });
  });

  // Gestion des erreurs globales
  app.use((err, req, res, next) => {
    console.error('Erreur serveur:', err);
    
    if (err.message && err.message.includes('Connection terminated')) {
      isDBConnected = false;
      setTimeout(initializeServer, 5000);
      return res.status(503).json({ 
        message: 'Connexion base de données perdue. Reconnexion en cours...' 
      });
    }
    
    res.status(500).json({ 
      message: 'Erreur interne du serveur',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  });

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Serveur PostgreSQL démarré sur le port ${PORT}`);
    console.log(`📊 API disponible sur: http://localhost:${PORT}/api`);
    console.log(`❤️  Health check: http://localhost:${PORT}/api/health`);
    console.log(`🗄️  Initialisation BD: http://localhost:${PORT}/api/init-db`);
    console.log(`🔧 Réparation séquences: http://localhost:${PORT}/api/fix-sequences`);
  });
};

// Démarrer l'initialisation
initializeServer();

// Nettoyage gracieux
process.on('SIGINT', async () => {
  console.log('\n🛑 Arrêt gracieux du serveur...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Arrêt gracieux du serveur...');
  await pool.end();
  process.exit(0);
});