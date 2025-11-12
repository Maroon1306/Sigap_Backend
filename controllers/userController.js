const User = require('../models/User');

class UserController {
  static async createUser(req, res) {
    try {
      const { immatricule, nom_complet, role } = req.body;

      if (!immatricule || !nom_complet || !role) {
        return res.status(400).json({ message: 'Tous les champs sont requis' });
      }

      const username = immatricule.toLowerCase();
      const password = Math.random().toString(36).slice(-8);

      const userData = {
        immatricule,
        nom_complet,
        username,
        password,
        role
      };

      await User.create(userData);

      res.status(201).json({
        message: 'Utilisateur créé avec succès',
        user: {
          username,
          password,
          nom_complet,
          role
        }
      });
    } catch (error) {
      console.error('Erreur création utilisateur:', error);
      if (error.code === 'ER_DUP_ENTRY') {
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