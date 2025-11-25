const { pool } = require('../config/database');

class PersonController {

  // ==================================
  // LISTE DES PERSONNES (+ relation)
  // ==================================
  static async list(req, res) {
    try {
      const residenceId = req.query.residence_id;

      const sql = residenceId
        ? `
          SELECT p.*,
                 pr.relation_type,
                 pr.parent_id,
                 pr.is_proprietaire,
                 pr.famille_id
          FROM persons p
          LEFT JOIN person_relations pr ON p.id = pr.person_id
          WHERE p.residence_id = $1
          ORDER BY p.id DESC
        `
        : `
          SELECT p.*,
                 pr.relation_type,
                 pr.parent_id,
                 pr.is_proprietaire,
                 pr.famille_id
          FROM persons p
          LEFT JOIN person_relations pr ON p.id = pr.person_id
          ORDER BY p.id DESC
        `;

      const params = residenceId ? [residenceId] : [];
      const result = await pool.query(sql, params);

      res.json(result.rows);

    } catch (err) {
      console.error("Erreur récupération personnes:", err);
      res.status(500).json({ error: "Erreur serveur" });
    }
  }

  // ==================================
  // CRÉATION AVEC TRANSACTION
  // ==================================
  static async create(req, res) {
    const client = await pool.connect();

    try {
      const {
        residence_id,
        nom_complet,
        date_naissance,
        cin,
        genre,
        telephone,
        relation_type,
        parent_id,
        is_proprietaire,
        famille_id
      } = req.body;

      if (!residence_id || !nom_complet)
        return res.status(400).json({ error: "residence_id et nom_complet requis" });

      await client.query("BEGIN");

      // 1) Insérer la personne
      const personSql = `
        INSERT INTO persons
          (residence_id, nom_complet, date_naissance, cin, genre, telephone, created_at)
        VALUES
          ($1,$2,$3,$4,$5,$6,NOW())
        RETURNING id
      `;

      const personResult = await client.query(personSql, [
        residence_id,
        nom_complet,
        date_naissance || null,
        cin || null,
        genre || null,
        telephone || null
      ]);

      const personId = personResult.rows[0].id;

      // 2) Insérer la relation si fournie
      if (relation_type || is_proprietaire !== undefined) {
        const relationSql = `
          INSERT INTO person_relations
            (person_id, relation_type, parent_id, is_proprietaire, famille_id)
          VALUES ($1,$2,$3,$4,$5)
        `;
        await client.query(relationSql, [
          personId,
          relation_type || null,
          parent_id || null,
          is_proprietaire || false,
          famille_id || null
        ]);
      }

      await client.query("COMMIT");

      // 3) Retourner la personne créée
      const getSql = `
        SELECT p.*, pr.relation_type, pr.parent_id, pr.is_proprietaire, pr.famille_id
        FROM persons p
        LEFT JOIN person_relations pr ON p.id = pr.person_id
        WHERE p.id = $1
      `;
      const fullPerson = await client.query(getSql, [personId]);

      res.status(201).json(fullPerson.rows[0]);

    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Erreur création personne:", err);
      res.status(500).json({ error: "Erreur création personne" });
    } finally {
      client.release();
    }
  }

  // ==================================
  // UPDATE
  // ==================================
  static async update(req, res) {
    try {
      const id = req.params.id;
      const { nom_complet, date_naissance, cin, genre, telephone } = req.body;

      const sql = `
        UPDATE persons
        SET nom_complet=$1, date_naissance=$2, cin=$3, genre=$4, telephone=$5
        WHERE id=$6
      `;

      await pool.query(sql, [
        nom_complet,
        date_naissance || null,
        cin || null,
        genre || null,
        telephone || null,
        id
      ]);

      const result = await pool.query("SELECT * FROM persons WHERE id=$1", [id]);
      res.json(result.rows[0]);

    } catch (err) {
      console.error("Erreur mise à jour personne:", err);
      res.status(500).json({ error: "Erreur mise à jour" });
    }
  }

  // ==================================
  // DELETE
  // ==================================
  static async remove(req, res) {
    try {
      const id = req.params.id;

      await pool.query("DELETE FROM persons WHERE id=$1", [id]);

      res.status(204).end();

    } catch (err) {
      console.error("Erreur suppression personne:", err);
      res.status(500).json({ error: "Erreur suppression" });
    }
  }
}

module.exports = PersonController;