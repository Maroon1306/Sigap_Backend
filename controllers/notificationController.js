const { pool } = require('../config/database');

class NotificationController {

  // ============================
  // 1. Récupérer les notifications d'un utilisateur
  // ============================
  static async getUserNotifications(req, res) {
    try {
      const userId = req.user.id;

      const query = `
        SELECT n.*,
               u.nom_complet AS sender_name,
               u.role AS sender_role
        FROM notifications n
        LEFT JOIN users u ON n.sender_id = u.id
        WHERE n.recipient_id = $1
        ORDER BY n.created_at DESC
        LIMIT 50
      `;

      const result = await pool.query(query, [userId]);
      res.json(result.rows);

    } catch (error) {
      console.error("Erreur getUserNotifications:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  }


  // ============================
  // 2. Marquer une notification comme lue
  // ============================
  static async markAsRead(req, res) {
    try {
      const userId = req.user.id;
      const { notificationId } = req.params;

      const query =
        `UPDATE notifications
         SET is_read = TRUE, updated_at = NOW()
         WHERE id = $1 AND recipient_id = $2`;

      await pool.query(query, [notificationId, userId]);

      res.json({ message: "Notification marquée comme lue" });
    } catch (error) {
      console.error("Erreur markAsRead:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  }


  // ============================
  // 3. Compter les notifications non lues
  // ============================
  static async getUnreadCount(req, res) {
    try {
      const userId = req.user.id;

      const query =
        `SELECT COUNT(*) FROM notifications
         WHERE recipient_id = $1 AND is_read = FALSE`;

      const result = await pool.query(query, [userId]);

      res.json({ unreadCount: parseInt(result.rows[0].count) });

    } catch (error) {
      console.error("Erreur getUnreadCount:", error);
      res.status(500).json({ message: "Erreur serveur" });
    }
  }


  // ============================
  // 4. Créer une notification (utilisable partout)
  // ============================
  static async createNotification(data) {
    try {
      const { type, title, message, recipient_id, sender_id, related_entity_id, status } = data;

      const query = `
        INSERT INTO notifications
        (type, title, message, recipient_id, sender_id, related_entity_id, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING *
      `;

      const values = [
        type,
        title,
        message,
        recipient_id,
        sender_id || null,
        related_entity_id || null,
        status || "pending"
      ];

      const result = await pool.query(query, values);
      return result.rows[0];

    } catch (error) {
      console.error("Erreur createNotification:", error);
      throw error;
    }
  }
}

module.exports = NotificationController;