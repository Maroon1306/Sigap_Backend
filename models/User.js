const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');

class User {
  static async create(userData) {
    const { immatricule, nom_complet, username, password, role, fokontany_id } = userData;
    const hashedPassword = await bcrypt.hash(password, 10);

    const query = `
      INSERT INTO users (immatricule, nom_complet, username, password, role, fokontany_id) 
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const values = [immatricule, nom_complet, username, hashedPassword, role, fokontany_id];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  static async findByUsername(username) {
    const query = 'SELECT * FROM users WHERE username = $1 AND is_active = TRUE';
    const { rows } = await pool.query(query, [username]);
    return rows[0];
  }

  static async findByUsernameWithFokontany(username) {
    const query = `
      SELECT u.*, f.nom as fokontany_nom, f.coordinates as fokontany_coordinates, 
             f.centre_lat as fokontany_centre_lat, f.centre_lng as fokontany_centre_lng
      FROM users u
      LEFT JOIN fokontany f ON u.fokontany_id = f.id
      WHERE u.username = $1 AND u.is_active = TRUE
    `;
    const { rows } = await pool.query(query, [username]);
    return rows[0];
  }

  static async findByImmatricule(immatricule) {
    const query = 'SELECT * FROM users WHERE immatricule = $1 AND is_active = TRUE';
    const { rows } = await pool.query(query, [immatricule]);
    return rows[0];
  }

  static async findById(id) {
    const query = 'SELECT id, immatricule, nom_complet, username, role, is_active, photo, fokontany_id FROM users WHERE id = $1';
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  }

  static async findByIdWithFokontany(id) {
    const query = `
      SELECT u.*, f.nom as fokontany_nom, f.coordinates as fokontany_coordinates,
             f.centre_lat as fokontany_centre_lat, f.centre_lng as fokontany_centre_lng
      FROM users u
      LEFT JOIN fokontany f ON u.fokontany_id = f.id
      WHERE u.id = $1
    `;
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  }

  static async findByIdWithPassword(id) {
    const query = 'SELECT * FROM users WHERE id = $1';
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  }

  static async getAll() {
    const query = `
      SELECT u.id, u.immatricule, u.nom_complet, u.username, u.role, u.is_active,
             u.created_at, u.photo, u.fokontany_id, f.nom as fokontany_nom
      FROM users u
      LEFT JOIN fokontany f ON u.fokontany_id = f.id
      ORDER BY u.nom_complet
    `;
    const { rows } = await pool.query(query);
    return rows;
  }

  static async update(id, userData) {
    const { nom_complet, username, role, is_active, fokontany_id } = userData;

    const query = `
      UPDATE users
      SET nom_complet = $1, username = $2, role = $3, is_active = $4, fokontany_id = $5
      WHERE id = $6
      RETURNING *
    `;
    const values = [nom_complet, username, role, is_active, fokontany_id, id];
    const { rows } = await pool.query(query, values);
    return rows[0];
  }

  static async updatePassword(id, newPassword) {
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const query = 'UPDATE users SET password = $1 WHERE id = $2 RETURNING *';
    const { rows } = await pool.query(query, [hashedPassword, id]);
    return rows[0];
  }

  static async delete(id) {
    const query = 'DELETE FROM users WHERE id = $1 RETURNING *';
    const { rows } = await pool.query(query, [id]);
    return rows[0];
  }

  static async comparePassword(plainPassword, hashedPassword) {
    return await bcrypt.compare(plainPassword, hashedPassword);
  }
}

module.exports = User;