const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { pool } = require('../config/database');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'Accès refusé. Token manquant.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'sigap_secret');

    // Récupération de l'utilisateur depuis PostgreSQL
    const user = await User.getById(decoded.id); // Assure-toi que getById utilise pool.query

    if (!user) {
      return res.status(401).json({ message: 'Token invalide.' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Erreur auth middleware:', error);
    res.status(401).json({ message: 'Token invalide.' });
  }
};

module.exports = auth;