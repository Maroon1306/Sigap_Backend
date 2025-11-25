const User = require('../models/User');

class UserController {
  static async createUser(req, res) {
    try {
      const { immatricule, nom_complet, role, fokontany_code } = req.body;

      if (!immatricule || !nom_complet || !role) {
        return res.status(400).json({ message: 'Tous les champs sont requis' });
      }

      const username = immatricule.toLowerCase();
      const password = Math.random().toString(36).slice(-8);

      // if you want to resolve fokontany_code to an id, implement here (requires a fokontany model or pool)
      let userData = { immatricule, nom_complet, username, password, role };

      // optional: handle fokontany_code -> fokontany_id resolution if provided
      if (fokontany_code) {
        // you can add lookup here using pool query to fokontany table
        userData.fokontany_id = null; // placeholder
      }

      await User.create(userData);

      res.status(201).json({
        message: 'Utilisateur créé avec succès',
        user: {
          username,
          password,
          nom_complet,
          role,
          fokontany_code: fokontany_code || null
        }
      });
    } catch (error) {
      console.error('Erreur création utilisateur:', error);
      // Postgres unique violation code is '23505'
      if (error.code === '23505') {
        return res.status(400).json({ message: 'Immatricule ou username déjà utilisé' });
      }
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

  static async getAllUsers(req, res) {
    try {
      const users = await User.getAll();
      res.json(users);
    } catch (error) {
      console.error('Erreur récupération utilisateurs:', error);
      res.status(500).json({ message: 'Erreur serveur' });
    }
  }

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