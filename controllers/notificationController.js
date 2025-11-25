const { pool } = require('../config/database');

class NotificationController {
  static async createNotification(req, res) {
    try {
      const { type, title, message, recipient_id, related_entity_id } = req.body;
      if (!type || !title || !message || !recipient_id) return res.status(400).json({ message: 'Champs requis manquants' });
      const q = `INSERT INTO notifications (type, title, message, recipient_id, sender_id, related_entity_id, status, created_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`;
      const result = await pool.query(q, [type, title, message, recipient_id, req.user ? req.user.id : null, related_entity_id || null, 'pending']);
      res.status(201).json({ message: 'Notification créée', notification: result.rows[0] });
    } catch (err) {
      console.error('createNotification error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async getNotificationsForUser(req, res) {
    try {
      const userId = req.user ? req.user.id : null;
      if (!userId) return res.status(401).json({ message: 'Utilisateur non authentifié' });
      const q = 'SELECT * FROM notifications WHERE recipient_id=$1 ORDER BY created_at DESC';
      const result = await pool.query(q, [userId]);
      res.json(result.rows);
    } catch (err) {
      console.error('getNotificationsForUser error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async markAsRead(req, res) {
    try {
      const { id } = req.params;
      await pool.query('UPDATE notifications SET is_read = TRUE, updated_at = NOW() WHERE id = $1', [id]);
      res.json({ message: 'Notification marquée comme lue' });
    } catch (err) {
      console.error('markAsRead error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async updateNotificationStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      if (!['pending','approved','rejected'].includes(status)) return res.status(400).json({ message: 'Status invalide' });
      await pool.query('UPDATE notifications SET status=$1, updated_at=NOW() WHERE id=$2', [status, id]);
      res.json({ message: 'Status mis à jour' });
    } catch (err) {
      console.error('updateNotificationStatus error', err);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }
}

module.exports = NotificationController;