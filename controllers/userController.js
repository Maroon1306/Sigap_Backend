const User = require('../models/User');
const { pool } = require('../config/database');

class UserController {
  // Création d'un utilisateur
  static async createUser(req, res) {
    try {
      const { immatricule, nom_complet, role, fokontany_code } = req.body;

      if (!immatricule || !nom_complet || !role) {
        return res.status(400).json({ message: 'Tous les champs sont requis' });
      }

      const username = immatricule.toLowerCase();
      const password = Math.random().toString(36).slice(-8);

      let fokontany_id = null;

      if (fokontany_code) {
        const given = (fokontany_code || '').trim();
        if (!given) return res.status(400).json({ message: 'Fokontany requis' });

        // 1) Chercher par code exact
        let { rows } = await pool.query(
          'SELECT id, code, nom FROM fokontany WHERE code = $1 LIMIT 1',
          [given]
        );

        // 2) Si pas trouvé, chercher par nom exact (insensible à la casse)
        if (rows.length === 0) {
          ({ rows } = await pool.query(
            'SELECT id, code, nom FROM fokontany WHERE LOWER(nom) = LOWER($1) LIMIT 1',
            [given]
          ));
        }

        // 3) Si toujours pas, chercher par LIKE (code ou nom)
        if (rows.length === 0) {
          const like = `%${given}%`;
          const matches = await pool.query(
            'SELECT id, code, nom FROM fokontany WHERE code ILIKE $1 OR nom ILIKE $2 LIMIT 10',
            [like, like]
          );

          if (matches.rows.length === 1) {
            rows = matches.rows;
          } else if (matches.rows.length > 1) {
            return res.status(400).json({ message: 'Plusieurs fokontany correspondent', matches: matches.rows });
          } else {
            return res.status(400).json({ message: `Fokontany introuvable: ${given}` });
          }
        }

        fokontany_id = rows[0].id;
      }

      const userData = { immatricule, nom_complet, username, password, role, fokontany_id };

      await User.create(userData);

      res.status(201).json({
        message: 'Utilisateur créé avec succès',
        user: { username, password, nom_complet, role, fokontany_code: fokontany_code || null }
      });
    } catch (error) {
      console.error('Erreur création utilisateur:', error);
      if (error.code === '23505') { // Unique violation PostgreSQL
        return res.status(400).json({ message: 'Immatricule ou username déjà utilisé' });
      }
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Récupérer tous les utilisateurs
  static async getAllUsers(req, res) {
    try {
      const users = await User.getAll(); // Assure-toi que User.getAll() utilise le pool PostgreSQL
      res.json(users);
    } catch (error) {
      console.error('Erreur récupération utilisateurs:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Mettre à jour un utilisateur
  static async updateUser(req, res) {
    try {
      const { id } = req.params;
      const userData = req.body;
      await User.update(id, userData);
      res.json({ message: 'Utilisateur mis à jour avec succès' });
    } catch (error) {
      console.error('Erreur mise à jour utilisateur:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Supprimer un utilisateur
  static async deleteUser(req, res) {
    try {
      const { id } = req.params;
      await User.delete(id);
      res.json({ message: 'Utilisateur supprimé avec succès' });
    } catch (error) {
      console.error('Erreur suppression utilisateur:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  // Désactiver un utilisateur
  static async deactivateUser(req, res) {
    try {
      const { id } = req.params;
      await User.update(id, { is_active: false });
      res.json({ message: 'Utilisateur désactivé avec succès' });
    } catch (error) {
      console.error('Erreur désactivation utilisateur:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }
}

module.exports = UserController;