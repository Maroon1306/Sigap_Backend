const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  static async create(userData) {
    const { immatricule, nom_complet, username, password, role } = userData;
    const hashedPassword = await bcrypt.hash(password, 10);

    const query = `
      INSERT INTO users (immatricule, nom_complet, username, password, role) 
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const values = [immatricule, nom_complet, username, hashedPassword, role];
    const res = await pool.query(query, values);
    return res.rows[0];
  }

  static async findByUsername(username) {
    const query = 'SELECT * FROM users WHERE username=$1 AND is_active=TRUE';
    const res = await pool.query(query, [username]);
    return res.rows[0];
  }

  static async findByImmatricule(immatricule) {
    const query = 'SELECT * FROM users WHERE immatricule=$1 AND is_active=TRUE';
    const res = await pool.query(query, [immatricule]);
    return res.rows[0];
  }

  static async findById(id) {
    const query = 'SELECT id, immatricule, nom_complet, username, role, is_active FROM users WHERE id=$1';
    const res = await pool.query(query, [id]);
    return res.rows[0];
  }

  static async getAll() {
    const query = 'SELECT id, immatricule, nom_complet, username, role, is_active, created_at FROM users';
    const res = await pool.query(query);
    return res.rows;
  }

  static async update(id, userData) {
    const { nom_complet, username, role, is_active } = userData;
    const query = `
      UPDATE users 
      SET nom_complet=$1, username=$2, role=$3, is_active=$4
      WHERE id=$5
      RETURNING *
    `;
    const res = await pool.query(query, [nom_complet, username, role, is_active, id]);
    return res.rows[0];
  }

  static async updatePassword(id, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const query = 'UPDATE users SET password=$1 WHERE id=$2 RETURNING *';
    const res = await pool.query(query, [hashedPassword, id]);
    return res.rows[0];
  }

  static async delete(id) {
    const query = 'DELETE FROM users WHERE id=$1';
    await pool.query(query, [id]);
    return true;
  }

  static async comparePassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }
}

module.exports = User;
