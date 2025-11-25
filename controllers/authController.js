const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configuration multer pour l'upload des photos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    // req.user doit être présent (middleware auth)
    const userId = req.user && req.user.id ? req.user.id : 'anon';
    cb(null, 'profile-' + userId + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max
  },
  fileFilter: function (req, file, cb) {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Seules les images sont autorisées!'), false);
    }
  }
});

class AuthController {
  static async login(req, res) {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ message: 'Username et password requis' });

      const user = await User.findByUsername(username);
      if (!user) return res.status(401).json({ message: 'Identifiants invalides' });

      const isPasswordValid = await User.comparePassword(password, user.password);
      if (!isPasswordValid) return res.status(401).json({ message: 'Identifiants invalides' });

      const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role },
        process.env.JWT_SECRET || 'sigap_secret',
        { expiresIn: '24h' }
      );

      // Récupérer le fokontany associé si présent (si besoin détaillé)
      let fokontany = null;
      if (user.fokontany_id) {
        const q = `
          SELECT id, code, nom, commune, district, region, geometry_type, coordinates, centre_lat, centre_lng, type, source
          FROM fokontany
          WHERE id = $1
          LIMIT 1
        `;
        const fRes = await pool.query(q, [user.fokontany_id]);
        if (fRes.rows && fRes.rows.length > 0) {
          const f = fRes.rows[0];
          // tenter de parser coordinates si c'est un texte JSON
          try {
            if (f.coordinates && typeof f.coordinates === 'string') {
              f.coordinates = JSON.parse(f.coordinates);
            }
          } catch (e) {
            // laisse tel quel si parse échoue
          }
          fokontany = f;
        }
      }

      res.json({
        message: 'Connexion réussie',
        token,
        user: {
          id: user.id,
          immatricule: user.immatricule,
          nom_complet: user.nom_complet,
          username: user.username,
          role: user.role,
          photo: user.photo,
          fokontany: fokontany // peut être null
        }
      });
    } catch (error) {
      console.error('Erreur login:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Récupérer l'utilisateur courant avec fokontany (détail)
  static async getCurrentUser(req, res) {
    try {
      const userId = req.user && req.user.id;
      if (!userId) return res.status(401).json({ message: 'Non autorisé' });

      const user = await User.findByIdWithFokontany(userId);
      if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

      let fokontanyData = null;
      if (user.fokontany_coordinates) {
        try {
          fokontanyData = {
            id: user.fokontany_id,
            nom: user.fokontany_nom,
            coordinates: typeof user.fokontany_coordinates === 'string' ? JSON.parse(user.fokontany_coordinates) : user.fokontany_coordinates,
            centre_lat: user.fokontany_centre_lat,
            centre_lng: user.fokontany_centre_lng
          };
        } catch (e) {
          fokontanyData = {
            id: user.fokontany_id,
            nom: user.fokontany_nom,
            coordinates: user.fokontany_coordinates,
            centre_lat: user.fokontany_centre_lat,
            centre_lng: user.fokontany_centre_lng
          };
        }
      }

      const userResponse = {
        id: user.id,
        immatricule: user.immatricule,
        nom_complet: user.nom_complet,
        username: user.username,
        role: user.role,
        is_active: user.is_active,
        photo: user.photo,
        fokontany_id: user.fokontany_id,
        fokontany: fokontanyData
      };

      res.json(userResponse);
    } catch (error) {
      console.error('Erreur récupération utilisateur:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Upload photo (utiliser middleware upload.single('photo') avant la route)
  static async uploadProfilePhoto(req, res) {
    try {
      // multer remplit req.file
      if (!req.file) {
        return res.status(400).json({ message: 'Aucun fichier uploadé' });
      }

      const userId = req.user && req.user.id;
      if (!userId) return res.status(401).json({ message: 'Non autorisé' });

      // Récupérer l'utilisateur courant pour supprimer l'ancienne photo
      const currentUser = await User.findById(userId);
      if (currentUser && currentUser.photo) {
        const oldPhotoPath = path.join(__dirname, '../uploads', currentUser.photo);
        try {
          if (fs.existsSync(oldPhotoPath)) {
            fs.unlinkSync(oldPhotoPath);
          }
        } catch (err) {
          console.warn('Impossible de supprimer ancienne photo:', err);
        }
      }

      // Mettre à jour la photo dans la base de données
      const query = 'UPDATE users SET photo = $1, updated_at = NOW() WHERE id = $2 RETURNING photo';
      const values = [req.file.filename, userId];
      const result = await pool.query(query, values);

      res.json({
        message: 'Photo de profil mise à jour avec succès',
        photo: result.rows[0] ? result.rows[0].photo : req.file.filename
      });
    } catch (error) {
      console.error('Erreur upload photo:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Demande de changement de mot de passe (crée une demande en attente)
  static async changePassword(req, res) {
    try {
      const { oldPassword, newPassword } = req.body;
      const userId = req.user && req.user.id;

      if (!userId) return res.status(401).json({ message: 'Non autorisé' });
      if (!oldPassword || !newPassword) return res.status(400).json({ message: 'Ancien et nouveau mot de passe requis' });

      // Vérifier l'ancien mot de passe
      const user = await User.findByIdWithPassword(userId);
      if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

      const isOldPasswordValid = await User.comparePassword(oldPassword, user.password);
      if (!isOldPasswordValid) return res.status(401).json({ message: 'Ancien mot de passe incorrect' });

      // Hasher le nouveau mot de passe et créer la demande
      const newPasswordHash = await bcrypt.hash(newPassword, 10);

      const query = `
        INSERT INTO password_change_requests (user_id, new_password_hash, status, created_at)
        VALUES ($1, $2, 'pending', NOW())
        RETURNING id, user_id, status, created_at
      `;
      const values = [userId, newPasswordHash];
      const resInsert = await pool.query(query, values);

      res.json({
        message: 'Demande de changement de mot de passe envoyée. Attendez l\'approbation de l\'administrateur.',
        request: resInsert.rows[0]
      });
    } catch (error) {
      console.error('Erreur changement mot de passe:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Demande de reset par immatricule (utilisateur agent/secretaire)
  static async requestPasswordReset(req, res) {
    try {
      const { immatricule } = req.body;
      if (!immatricule) return res.status(400).json({ message: 'Immatricule requis' });

      const user = await User.findByImmatricule(immatricule);
      if (!user) return res.status(404).json({ message: 'Immatricule non trouvé' });

      if (!['agent', 'secretaire'].includes(user.role)) {
        return res.status(403).json({ message: 'Cette fonctionnalité est réservée aux agents et secrétaires' });
      }

      const query = `
        INSERT INTO password_reset_requests (user_id, immatricule, status, created_at)
        VALUES ($1, $2, 'pending', NOW())
        RETURNING id, user_id, immatricule, status, created_at
      `;
      const values = [user.id, immatricule];
      const r = await pool.query(query, values);

      res.json({
        message: 'Demande de réinitialisation envoyée. Attendez la confirmation de l\'administrateur.',
        request: r.rows[0],
        user: {
          id: user.id,
          nom_complet: user.nom_complet,
          immatricule: user.immatricule,
          username: user.username
        }
      });
    } catch (error) {
      console.error('Erreur demande reset password:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Récupérer demandes reset en attente
  static async getPendingResetRequests(req, res) {
    try {
      const query = `
        SELECT prr.*, u.nom_complet, u.username, u.role
        FROM password_reset_requests prr
        JOIN users u ON prr.user_id = u.id
        WHERE prr.status = 'pending'
        ORDER BY prr.created_at DESC
      `;
      const result = await pool.query(query);
      res.json(result.rows);
    } catch (error) {
      console.error('Erreur get pending requests:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Récupérer demandes changement de mot de passe en attente
  static async getPendingPasswordChangeRequests(req, res) {
    try {
      const query = `
        SELECT pcr.*, u.nom_complet, u.username, u.role, u.immatricule
        FROM password_change_requests pcr
        JOIN users u ON pcr.user_id = u.id
        WHERE pcr.status = 'pending'
        ORDER BY pcr.created_at DESC
      `;
      const result = await pool.query(query);
      res.json(result.rows);
    } catch (error) {
      console.error('Erreur get pending change requests:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Approuver une demande de réinitialisation et définir un nouveau mot de passe
  static async approvePasswordReset(req, res) {
    try {
      const { requestId, newPassword } = req.body;
      if (!requestId || !newPassword) return res.status(400).json({ message: 'ID de demande et nouveau mot de passe requis' });

      // Vérifier demande en attente
      const getRequestQuery = 'SELECT * FROM password_reset_requests WHERE id = $1 AND status = $2';
      const requestRes = await pool.query(getRequestQuery, [requestId, 'pending']);
      if (requestRes.rows.length === 0) return res.status(404).json({ message: 'Demande non trouvée' });

      const request = requestRes.rows[0];

      // Mettre à jour le mot de passe (User.updatePassword hash à l'intérieur)
      await User.updatePassword(request.user_id, newPassword);

      // Mettre à jour le statut de la demande
      const updateRequestQuery = 'UPDATE password_reset_requests SET status = $1, updated_at = NOW() WHERE id = $2';
      await pool.query(updateRequestQuery, ['approved', requestId]);

      res.json({ message: 'Mot de passe réinitialisé avec succès' });
    } catch (error) {
      console.error('Erreur approbation reset:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Approuver une demande de changement (utilise transaction : écrire password & marquer approved)
  static async approvePasswordChange(req, res) {
    const client = await pool.connect();
    try {
      const { requestId } = req.body;
      if (!requestId) return res.status(400).json({ message: 'ID de demande requis' });

      await client.query('BEGIN');

      const getRequestQuery = 'SELECT * FROM password_change_requests WHERE id = $1 AND status = $2 FOR UPDATE';
      const reqResult = await client.query(getRequestQuery, [requestId, 'pending']);

      if (reqResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Demande non trouvée' });
      }

      const request = reqResult.rows[0];

      // Mettre à jour le mot de passe de l'utilisateur avec le hash déjà stocké
      const updatePasswordQuery = 'UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2';
      await client.query(updatePasswordQuery, [request.new_password_hash, request.user_id]);

      // Marquer la demande comme approuvée
      const updateRequestQuery = 'UPDATE password_change_requests SET status = $1, updated_at = NOW() WHERE id = $2';
      await client.query(updateRequestQuery, ['approved', requestId]);

      await client.query('COMMIT');

      res.json({ message: 'Changement de mot de passe approuvé avec succès' });
    } catch (error) {
      await client.query('ROLLBACK').catch(e => console.error('ROLLBACK error', e));
      console.error('Erreur approbation changement:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    } finally {
      client.release();
    }
  }

  // Invalider (forcer) le mot de passe d'un utilisateur (admin action)
  static async invalidatePassword(req, res) {
    try {
      const { userId, tempPassword } = req.body;

      if (!userId || !tempPassword) {
        return res.status(400).json({ message: 'User ID et mot de passe temporaire requis' });
      }

      if (tempPassword.length < 8) {
        return res.status(400).json({ message: 'Le mot de passe temporaire doit contenir au moins 8 caractères' });
      }

      // Vérifier que l'utilisateur existe
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: 'Utilisateur non trouvé' });

      // Interdire pour admin
      if (user.role === 'admin') {
        return res.status(403).json({ message: 'Impossible d\'invalider le mot de passe d\'un administrateur' });
      }

      const hashedTempPassword = await bcrypt.hash(tempPassword, 12);

      const query = 'UPDATE users SET password = $1, must_change_password = TRUE, updated_at = NOW() WHERE id = $2 RETURNING id';
      const result = await pool.query(query, [hashedTempPassword, userId]);

      if (!result.rows || result.rows.length === 0) {
        return res.status(404).json({ message: 'Utilisateur non trouvé' });
      }

      res.json({ message: 'Mot de passe invalidé avec succès', tempPassword });
    } catch (error) {
      console.error('Erreur invalidation:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }
}

module.exports = { AuthController, upload };