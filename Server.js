const express = require('express');
const cors = require('cors');
require('dotenv').config();
const bcrypt = require('bcryptjs');

const { pool } = require('./config/database'); // pool PostgreSQL

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

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
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Créer table password_reset_requests
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_requests (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        immatricule VARCHAR(50) NOT NULL,
        status TEXT CHECK (status IN ('pending','approved','rejected')) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Créer l'admin par défaut si pas déjà présent
    const defaultPassword = bcrypt.hashSync('admin1234', 10);
    const insertAdminQuery = `
      INSERT INTO users (immatricule, nom_complet, username, password, role)
      VALUES ('ADMIN001', 'Administrateur SIGAP', 'admin', $1, 'admin')
      ON CONFLICT (username) DO NOTHING
    `;
    await pool.query(insertAdminQuery, [defaultPassword]);

    res.json({ 
      message: 'Base de données initialisée avec succès',
      admin: {
        username: 'admin',
        password: 'admin1234'
      }
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

app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log(`📊 API disponible sur: http://localhost:${PORT}/api`);
  console.log(`🗄️  Initialisation BD: http://localhost:${PORT}/api/init-db`);
});
