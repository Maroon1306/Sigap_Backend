const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');
const auth = require('../middleware/auth');
const authorize = require('../middleware/role');
const { pool } = require('../config/database');

router.post('/', auth, authorize('admin'), UserController.createUser);
router.get('/', auth, authorize('admin'), UserController.getAllUsers);
router.put('/:id', auth, authorize('admin'), UserController.updateUser);
router.delete('/:id', auth, authorize('admin'), UserController.deleteUser);
router.patch('/:id/deactivate', auth, authorize('admin'), UserController.deactivateUser);

// POST /users avec recherche fokontany (PostgreSQL)
router.post('/users', auth, async (req, res) => {
  try {
    const given = (req.body.fokontanyCode || req.body.fokontany || '').trim();
    if (!given) return res.status(400).json({ error: 'Fokontany requis' });

    let rows = [];

    // 1) chercher par code exact
    ({ rows } = await pool.query('SELECT id, code, nom FROM fokontany WHERE code = $1 LIMIT 1', [given]));

    // 2) si pas trouvé, chercher par nom exact (insensible à la casse)
    if (!rows.length) {
      ({ rows } = await pool.query('SELECT id, code, nom FROM fokontany WHERE LOWER(nom) = LOWER($1) LIMIT 1', [given]));
    }

    // 3) si toujours pas, chercher par LIKE
    if (!rows.length) {
      const like = `%${given}%`;
      const { rows: matches } = await pool.query(
        'SELECT id, code, nom FROM fokontany WHERE code LIKE $1 OR nom LIKE $2 LIMIT 10',
        [like, like]
      );
      if (matches.length === 1) {
        rows = matches;
      } else if (matches.length > 1) {
        return res.status(300).json({ error: 'Plusieurs fokontany correspondent', matches });
      } else {
        return res.status(400).json({ error: `Fokontany introuvable: ${given}` });
      }
    }

    const fokontanyId = rows[0].id;
    res.json({ success: true, fokontanyId });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;