const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const NotificationController = require('./notificationController');

// Config PostgreSQL
const { pool } = require('../config/database');

// Créer dossiers upload si manquants
const uploadsRoot = path.join(__dirname, '..', 'uploads');
const pendingDir = path.join(uploadsRoot, 'pending_residences');
if (!fs.existsSync(pendingDir)) fs.mkdirSync(pendingDir, { recursive: true });

class ResidenceController {
  // ======== RESIDENCES ========
  static async getResidences(req, res) {
    try {
      const result = await pool.query(`
        SELECT r.*, rt.name AS residence_type
        FROM residences r
        LEFT JOIN residence_types rt ON r.residence_type_id = rt.id
        WHERE r.status = true
      `);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getResidenceById(req, res) {
    try {
      const { id } = req.params;
      const result = await pool.query(`
        SELECT r.*, rt.name AS residence_type
        FROM residences r
        LEFT JOIN residence_types rt ON r.residence_type_id = rt.id
        WHERE r.id = $1
      `, [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Residence not found' });
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async createResidence(req, res) {
    try {
      const { name, address, residence_type_id } = req.body;
      const result = await pool.query(
        `INSERT INTO residences (name, address, residence_type_id, status)
         VALUES ($1, $2, $3, true) RETURNING *`,
        [name, address, residence_type_id]
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async updateResidence(req, res) {
    try {
      const { id } = req.params;
      const { name, address, residence_type_id } = req.body;
      const result = await pool.query(
        `UPDATE residences
         SET name = $1, address = $2, residence_type_id = $3
         WHERE id = $4 RETURNING *`,
        [name, address, residence_type_id, id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Residence not found' });
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async deactivateResidence(req, res) {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `UPDATE residences SET status = false WHERE id = $1 RETURNING *`,
        [id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Residence not found' });
      res.json({ message: 'Residence deactivated', residence: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // ======== PHOTOS ========
  static async uploadPhotos(req, res) {
    try {
      if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
      const { id } = req.params;

      const savedFiles = [];
      for (const file of req.files) {
        const dest = path.join(uploadsRoot, `residence_${id}_${Date.now()}_${file.originalname}`);
        fs.renameSync(file.path, dest);
        const dbResult = await pool.query(
          `INSERT INTO residence_photos (residence_id, filename) VALUES ($1, $2) RETURNING *`,
          [id, path.basename(dest)]
        );
        savedFiles.push(dbResult.rows[0]);
      }
      res.json(savedFiles);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getPhotos(req, res) {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `SELECT * FROM residence_photos WHERE residence_id = $1`,
        [id]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async deletePhoto(req, res) {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `DELETE FROM residence_photos WHERE id = $1 RETURNING *`,
        [id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Photo not found' });

      const filePath = path.join(uploadsRoot, result.rows[0].filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      res.json({ message: 'Photo deleted' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  // ======== PENDING RESIDENCES ========
  static async getPendingResidences(req, res) {
    try {
      const result = await pool.query(`SELECT * FROM pending_residences`);
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async getPendingResidenceById(req, res) {
    try {
      const { id } = req.params;
      const result = await pool.query(`SELECT * FROM pending_residences WHERE id = $1`, [id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Pending residence not found' });
      res.json(result.rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async approveResidence(req, res) {
    try {
      const { id } = req.params;
      // Récupérer pending residence
      const pending = await pool.query(`SELECT * FROM pending_residences WHERE id = $1`, [id]);
      if (pending.rows.length === 0) return res.status(404).json({ error: 'Pending residence not found' });
      const pr = pending.rows[0];

      // Insérer dans residences
      const newResidence = await pool.query(
        `INSERT INTO residences (name, address, residence_type_id, status)
         VALUES ($1, $2, $3, true) RETURNING *`,
        [pr.name, pr.address, pr.residence_type_id]
      );

      // Supprimer pending
      await pool.query(`DELETE FROM pending_residences WHERE id = $1`, [id]);

      // Déplacer photos
      const pendingFiles = fs.readdirSync(pendingDir).filter(f => f.startsWith(`pending_${id}_`));
      for (const file of pendingFiles) {
        const oldPath = path.join(pendingDir, file);
        const newPath = path.join(uploadsRoot, `residence_${newResidence.rows[0].id}_${file.replace(`pending_${id}_`, '')}`);
        fs.renameSync(oldPath, newPath);
        await pool.query(
          `INSERT INTO residence_photos (residence_id, filename) VALUES ($1, $2)`,
          [newResidence.rows[0].id, path.basename(newPath)]
        );
      }

      // Notification
      NotificationController.sendNotification(`Residence approved: ${newResidence.rows[0].name}`);

      res.json({ message: 'Residence approved', residence: newResidence.rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  static async rejectResidence(req, res) {
    try {
      const { id } = req.params;
      const pending = await pool.query(`SELECT * FROM pending_residences WHERE id = $1`, [id]);
      if (pending.rows.length === 0) return res.status(404).json({ error: 'Pending residence not found' });

      // Supprimer pending
      await pool.query(`DELETE FROM pending_residences WHERE id = $1`, [id]);

      // Supprimer photos
      const pendingFiles = fs.readdirSync(pendingDir).filter(f => f.startsWith(`pending_${id}_`));
      for (const file of pendingFiles) {
        fs.unlinkSync(path.join(pendingDir, file));
      }

      NotificationController.sendNotification(`Residence rejected: ${pending.rows[0].name}`);
      res.json({ message: 'Pending residence rejected' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = ResidenceController;
