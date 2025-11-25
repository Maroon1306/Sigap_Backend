const express = require('express');
const cors = require('cors');
require('dotenv').config();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const { pool } = require('./config/database'); // pool PostgreSQL
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const residencesRoutes = require('./routes/residences');
const fokontanyRoutes = require('./routes/fokontany');
const personsRoutes = require('./routes/persons');
const { importFromGeoJSON } = require('./scripts/importFokontany');

const auth = require('./middleware/auth');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// ensure uploads/residences exists
const uploadsDir = path.join(__dirname, 'uploads', 'residences');
fs.mkdirSync(uploadsDir, { recursive: true });

// multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).substr(2,6)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({ storage });

// --- ROUTES ---
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/residences', residencesRoutes);
app.use('/api/fokontany', fokontanyRoutes);
app.use('/api/persons', personsRoutes);

// Route de test
app.get('/api/test', (req, res) => {
  res.json({ message: '✅ API SIGAP fonctionnelle' });
});

// Init DB
app.get('/api/init-db', async (req, res) => {
  try {
    // users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        immatricule VARCHAR(50) UNIQUE NOT NULL,
        nom_complet VARCHAR(255) NOT NULL,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role TEXT CHECK (role IN ('admin','agent','secretaire')) DEFAULT 'agent',
        fokontany_id INT NULL REFERENCES fokontany(id) ON DELETE SET NULL,
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

    // residences table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS residences (
        id SERIAL PRIMARY KEY,
        lot VARCHAR(255) NOT NULL,
        quartier VARCHAR(255),
        ville VARCHAR(255),
        fokontany VARCHAR(255),
        lat DOUBLE PRECISION,
        lng DOUBLE PRECISION,
        created_by INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // persons table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS persons (
        id SERIAL PRIMARY KEY,
        residence_id INT NOT NULL REFERENCES residences(id) ON DELETE CASCADE,
        nom_complet VARCHAR(255) NOT NULL,
        date_naissance DATE NULL,
        cin VARCHAR(50) NULL,
        genre TEXT CHECK (genre IN ('homme','femme','autre')) DEFAULT 'homme',
        telephone VARCHAR(50) NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // photos table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS photos (
        id SERIAL PRIMARY KEY,
        residence_id INT NOT NULL REFERENCES residences(id) ON DELETE CASCADE,
        filename VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // person_relations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS person_relations (
        id SERIAL PRIMARY KEY,
        person_id INT NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        parent_id INT NULL REFERENCES persons(id) ON DELETE SET NULL,
        relation_type VARCHAR(191) NULL,
        is_proprietaire BOOLEAN DEFAULT FALSE,
        famille_id INT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Notifications table
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

    // pending_residences
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

    // Créer l'admin par défaut
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

// Import Fokontany depuis GeoJSON
app.get('/api/init-fokontany', async (req, res) => {
  try {
    const result = await importFromGeoJSON();
    res.json({ success: true, result });
  } catch (err) {
    console.error('init-fokontany error', err);
    res.status(500).json({ success: false, error: err.message || String(err) });
  }
});

// Upload photo
app.post('/api/residences/:id/photos', upload.single('photo'), async (req, res) => {
  const residenceId = parseInt(req.params.id, 10);
  if (!req.file || !residenceId) return res.status(400).json({ error: 'Missing file or residence id' });
  const filename = req.file.filename;
  try {
    const result = await pool.query(
      `INSERT INTO photos (residence_id, filename) VALUES ($1,$2) RETURNING id`,
      [residenceId, filename]
    );
    const fileUrl = `/uploads/residences/${filename}`;
    res.status(201).json({ id: result.rows[0].id, residence_id: residenceId, filename, url: fileUrl });
  } catch (err) {
    console.error('insert photo error', err);
    res.status(500).json({ error: 'Erreur enregistrement photo' });
  }
});

// Serve uploads statically
app.use('/uploads/residences', express.static(uploadsDir));

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ message: 'Route non trouvée' });
});

// Error handler
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
  console.log(`🗺️  Import fokontany: http://localhost:${PORT}/api/init-fokontany`);
  console.log(`📁 Dossier uploads: ${uploadsDir}`);
});