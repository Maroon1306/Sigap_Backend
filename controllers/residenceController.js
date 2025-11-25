const { pool } = require('../config/database');

class ResidenceController {
  // Soumettre une residence en attente (stockée dans pending_residences)
  static async submitPendingResidence(req, res) {
    try {
      const submittedBy = req.user ? req.user.id : null;
      const residenceData = req.body;
      if (!submittedBy) return res.status(401).json({ message: 'Utilisateur non authentifié' });
      if (!residenceData) return res.status(400).json({ message: 'Données de résidence requises' });

      const q = `INSERT INTO pending_residences (residence_data, submitted_by, status, created_at)
                 VALUES ($1,$2,$3,NOW()) RETURNING *`;
      const result = await pool.query(q, [residenceData, submittedBy, 'pending']);
      res.status(201).json({ message: 'Résidence soumise en attente', pending: result.rows[0] });
    } catch (err) {
      console.error('submitPendingResidence error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Lister les résidences en attente
  static async getPendingResidences(req, res) {
    try {
      const q = `
        SELECT pr.*, u.nom_complet as submitted_by_name
        FROM pending_residences pr
        JOIN users u ON pr.submitted_by = u.id
        ORDER BY pr.created_at DESC
      `;
      const result = await pool.query(q);
      res.json(result.rows);
    } catch (err) {
      console.error('getPendingResidences error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Approuver une residence en attente -> la déplacer dans la table residences
  static async approvePendingResidence(req, res) {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const getQ = 'SELECT * FROM pending_residences WHERE id=$1 FOR UPDATE';
      const pendingRes = await client.query(getQ, [id]);
      if (!pendingRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Pending residence introuvable' });
      }
      const pending = pendingRes.rows[0];

      // Insert into residences
      const insertQ = `
        INSERT INTO residences (residence_data, created_by, status, created_at)
        VALUES ($1,$2,$3,NOW()) RETURNING *
      `;
      const inserted = await client.query(insertQ, [pending.residence_data, pending.submitted_by, 'approved']);

      // Mark pending as approved
      await client.query('UPDATE pending_residences SET status=$1, reviewed_by=$2, updated_at=NOW() WHERE id=$3', ['approved', req.user ? req.user.id : null, id]);

      // Create notification for submitter
      const noteQ = `INSERT INTO notifications (type, title, message, recipient_id, sender_id, related_entity_id, status, created_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`;
      await client.query(noteQ, ['residence_approval', 'Résidence approuvée', 'Votre soumission a été approuvée', pending.submitted_by, req.user ? req.user.id : null, inserted.rows[0].id, 'approved']);

      await client.query('COMMIT');
      res.json({ message: 'Résidence approuvée', residence: inserted.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK').catch(()=>{});
      console.error('approvePendingResidence error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    } finally {
      client.release();
    }
  }

  // Rejeter une pending residence
  static async rejectPendingResidence(req, res) {
    try {
      const { id } = req.params;
      const { reason } = req.body;
      const getQ = 'SELECT * FROM pending_residences WHERE id=$1';
      const pendingRes = await pool.query(getQ, [id]);
      if (!pendingRes.rows.length) return res.status(404).json({ message: 'Pending introuvable' });

      await pool.query('UPDATE pending_residences SET status=$1, review_notes=$2, reviewed_by=$3, updated_at=NOW() WHERE id=$4', ['rejected', reason || null, req.user ? req.user.id : null, id]);

      // notification
      const pending = pendingRes.rows[0];
      await pool.query(
        `INSERT INTO notifications (type, title, message, recipient_id, sender_id, related_entity_id, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        ['residence_approval', 'Résidence rejetée', `Votre soumission a été rejetée: ${reason || 'sans précision'}`, pending.submitted_by, req.user ? req.user.id : null, id, 'rejected']
      );

      res.json({ message: 'Soumission rejetée' });
    } catch (err) {
      console.error('rejectPendingResidence error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Lister toutes les residences approuvées
  static async getResidences(req, res) {
    try {
      const q = 'SELECT id, residence_data, created_by, status, created_at FROM residences ORDER BY created_at DESC';
      const result = await pool.query(q);
      res.json(result.rows);
    } catch (err) {
      console.error('getResidences error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Détails d'une résidence
  static async getResidenceById(req, res) {
    try {
      const { id } = req.params;
      const q = 'SELECT id, residence_data, created_by, status, created_at FROM residences WHERE id=$1 LIMIT 1';
      const result = await pool.query(q, [id]);
      if (!result.rows.length) return res.status(404).json({ message: 'Résidence introuvable' });
      res.json(result.rows[0]);
    } catch (err) {
      console.error('getResidenceById error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Mettre à jour une résidence
  static async updateResidence(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;
      const q = 'UPDATE residences SET residence_data = $1, updated_at = NOW() WHERE id = $2 RETURNING *';
      const result = await pool.query(q, [updates, id]);
      if (!result.rows.length) return res.status(404).json({ message: 'Résidence introuvable' });
      res.json({ message: 'Résidence mise à jour', residence: result.rows[0] });
    } catch (err) {
      console.error('updateResidence error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Supprimer une résidence
  static async deleteResidence(req, res) {
    try {
      const { id } = req.params;
      await pool.query('DELETE FROM residences WHERE id=$1', [id]);
      res.json({ message: 'Résidence supprimée' });
    } catch (err) {
      console.error('deleteResidence error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }
}

module.exports = ResidenceController;