const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');

class AuthController {
  static async login(req, res) {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ message: 'Username et password requis' });

      const user = await User.findByUsername(username);
      if (!user) return res.status(401).json({ message: 'Identifiants invalides' });

      const isPasswordValid = await User.comparePassword(password, user.password);
      if (!isPasswordValid) return res.status(401).json({ message: 'Identifiants invalides' });

      const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET || 'sigap_secret', { expiresIn: '24h' });

      res.json({ message: 'Connexion réussie', token, user: {
        id: user.id,
        immatricule: user.immatricule,
        nom_complet: user.nom_complet,
        username: user.username,
        role: user.role,
        photo: user.photo,
        fokontany_id: user.fokontany_id
      }});
    } catch (error) {
      console.error('Erreur login:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async requestPasswordReset(req, res) {
    try {
      const { immatricule } = req.body;
      if (!immatricule) return res.status(400).json({ message: 'Immatricule requis' });

      const user = await User.findByImmatricule(immatricule);
      if (!user) return res.status(404).json({ message: 'Immatricule non trouvé' });

      if (!['agent', 'secretaire'].includes(user.role))
        return res.status(403).json({ message: 'Réservé aux agents et secrétaires' });

      const query = 'INSERT INTO password_reset_requests (user_id, immatricule, status, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *';
      const result = await pool.query(query, [user.id, immatricule, 'pending']);
      res.json({ message: 'Demande envoyée', request: result.rows[0] });
    } catch (error) {
      console.error('Erreur demande reset password:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async getPendingResetRequests(req, res) {
    try {
      const query = `
        SELECT prr.*, u.nom_complet, u.username, u.role
        FROM password_reset_requests prr
        JOIN users u ON prr.user_id = u.id
        WHERE prr.status = 'pending'
      `;
      const result = await pool.query(query);
      res.json(result.rows);
    } catch (error) {
      console.error('Erreur get pending requests:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async approvePasswordReset(req, res) {
    try {
      const { requestId, newPassword } = req.body;
      if (!requestId || !newPassword) return res.status(400).json({ message: 'ID et nouveau mot de passe requis' });

      const requestRes = await pool.query('SELECT * FROM password_reset_requests WHERE id=$1 AND status=$2', [requestId, 'pending']);
      if (requestRes.rows.length === 0) return res.status(404).json({ message: 'Demande non trouvée' });

      const request = requestRes.rows[0];
      await User.updatePassword(request.user_id, newPassword);

      await pool.query('UPDATE password_reset_requests SET status=$1 WHERE id=$2', ['approved', requestId]);
      res.json({ message: 'Mot de passe réinitialisé' });
    } catch (error) {
      console.error('Erreur approbation reset:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async invalidatePassword(req, res) {
    try {
      const { userId, tempPassword } = req.body;

      if (!userId || !tempPassword) {
        return res.status(400).json({ message: 'User ID et mot de passe temporaire requis' });
      }

      if (tempPassword.length < 8) {
        return res.status(400).json({ message: 'Le mot de passe temporaire doit contenir au moins 8 caractères' });
      }

      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });
      if (user.role === 'admin') return res.status(403).json({ message: 'Impossible d\'invalider le mot de passe d\'un administrateur' });

      const hashedTempPassword = await bcrypt.hash(tempPassword, 12);
      await pool.query('UPDATE users SET password=$1, must_change_password=TRUE WHERE id=$2', [hashedTempPassword, userId]);

      res.json({ message: 'Mot de passe invalidé avec succès', tempPassword });
    } catch (error) {
      console.error('Erreur invalidation:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }
}

module.exports = AuthController;