const express = require('express');
const router = express.Router();
const FokontanyController = require('../controllers/fokontanyController');
const auth = require('../middleware/auth');
const { pool } = require('../config/database');

router.get('/', auth, FokontanyController.getAllFokontany);
router.get('/region/:region', auth, FokontanyController.getFokontanyByRegion);
router.get('/user-location', auth, FokontanyController.getFokontanyByUserLocation);
router.get('/search', auth, FokontanyController.searchFokontany);
router.post('/create-test', auth, FokontanyController.createTestFokontany);
router.get('/me', auth, FokontanyController.getMyFokontany);

// Exemple direct pour /me avec PostgreSQL
router.get('/me', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM fokontany LIMIT 1');
    if (!rows || rows.length === 0) return res.json({ nom: null });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;