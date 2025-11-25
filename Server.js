const express = require('express');
const cors = require('cors');
require('dotenv').config();
const bcrypt = require('bcryptjs');

const { pool } = require('./config/database'); // pool PostgreSQL

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const fokontanyRoutes = require('./routes/fokontany'); // route à créer si pas encore
// ajoute autres routes si converties

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/fokontany', fokontanyRoutes);

// Route de test
app.get('/api/test', (req, res) => {
  res.json({ message: '✅ API SIGAP fonctionnelle' });
});

// Route pour créer les tables automatiquement
app.get('/api/init-db', async (req, res) => {
  try {
    // Créer table users
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        immatricule VARCHAR(50) UNIQUE NOT NULL,
        nom_complet VARCHAR(255) NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role TEXT CHECK (role IN ('admin','agent','secretaire')) DEFAULT 'agent',
        fokontany_id INT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        photo VARCHAR(255) NULL,
        must_change_password BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // fokontany table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fokontany (
        id SERIAL PRIMARY KEY,
        code VARCHAR(191) UNIQUE NOT NULL,
        nom VARCHAR(255) NOT NULL,
        commune VARCHAR(191),
        district VARCHAR(191),
        region VARCHAR(191),
        geometry_type VARCHAR(50),
        coordinates JSONB,
        centre_lat DOUBLE PRECISION,
        centre_lng DOUBLE PRECISION,
        type VARCHAR(50),
        source VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // password_reset_requests
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_requests (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        immatricule VARCHAR(50) NOT NULL,
        status TEXT CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // password_change_requests
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_change_requests (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        new_password_hash VARCHAR(255) NOT NULL,
        status TEXT CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Notifications and pending_residences
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        type TEXT CHECK (type IN ('residence_approval','password_change','password_reset')) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        recipient_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        sender_id INT NULL REFERENCES users(id) ON DELETE SET NULL,
        related_entity_id INT NULL,
        status TEXT CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS pending_residences (
        id SERIAL PRIMARY KEY,
        residence_data JSONB NOT NULL,
        submitted_by INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
        reviewed_by INT NULL REFERENCES users(id) ON DELETE SET NULL,
        review_notes TEXT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Créer l'admin par défaut si pas déjà présent
    const defaultPassword = bcrypt.hashSync('admin1234', 10);
    await pool.query(
      `INSERT INTO users (immatricule, nom_complet, username, password, role)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (username) DO NOTHING`,
      ['ADMIN001', 'Administrateur SIGAP', 'admin', defaultPassword, 'admin']
    );

    res.json({
      message: 'Base de données initialisée avec succès',
      admin: { username: 'admin', password: 'admin1234' }
    });
  } catch (err) {
    console.error('Erreur initialisation BD:', err);
    res.status(500).json({ error: 'Erreur initialisation BD' });
  }
});

// Gestion des erreurs 404
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route non trouvée' });
});

// Gestion des erreurs globales
app.use((err, req, res, next) => {
  console.error('Erreur serveur:', err);
  res.status(500).json({ message: 'Erreur interne du serveur' });
});

const HOST = '0.0.0.0';
const PORT = process.env.PORT || 5000;

app.listen(PORT, HOST, () => {
  console.log(`🚀 Serveur SIGAP démarré sur ${HOST}:${PORT}`);
  console.log(`📊 API disponible sur: http://localhost:${PORT}/api`);
  console.log(`🗄️  Initialisation BD: http://localhost:${PORT}/api/init-db`);
});