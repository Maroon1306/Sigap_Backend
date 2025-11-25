const { pool } = require('../config/database');

class PersonController {
  static async createPerson(req, res) {
    try {
      const data = req.body;
      if (!data || !data.nom) return res.status(400).json({ message: 'Données de la personne requises' });
      const q = `INSERT INTO persons (person_data, created_by, created_at) VALUES ($1,$2,NOW()) RETURNING *`;
      const result = await pool.query(q, [data, req.user ? req.user.id : null]);
      res.status(201).json({ message: 'Personne créée', person: result.rows[0] });
    } catch (err) {
      console.error('createPerson error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async getPerson(req, res) {
    try {
      const { id } = req.params;
      const q = 'SELECT id, person_data, created_by, created_at FROM persons WHERE id=$1 LIMIT 1';
      const result = await pool.query(q, [id]);
      if (!result.rows.length) return res.status(404).json({ message: 'Personne introuvable' });
      res.json(result.rows[0]);
    } catch (err) {
      console.error('getPerson error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async getAllPersons(req, res) {
    try {
      const q = 'SELECT id, person_data, created_by, created_at FROM persons ORDER BY created_at DESC';
      const result = await pool.query(q);
      res.json(result.rows);
    } catch (err) {
      console.error('getAllPersons error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async updatePerson(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;
      const q = 'UPDATE persons SET person_data=$1, updated_at=NOW() WHERE id=$2 RETURNING *';
      const result = await pool.query(q, [updates, id]);
      if (!result.rows.length) return res.status(404).json({ message: 'Personne introuvable' });
      res.json({ message: 'Personne mise à jour', person: result.rows[0] });
    } catch (err) {
      console.error('updatePerson error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async deletePerson(req, res) {
    try {
      const { id } = req.params;
      await pool.query('DELETE FROM persons WHERE id=$1', [id]);
      res.json({ message: 'Personne supprimée' });
    } catch (err) {
      console.error('deletePerson error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }
}

module.exports = PersonController;