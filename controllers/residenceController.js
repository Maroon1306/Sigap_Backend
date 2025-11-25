const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { pool } = require('../config/database');
const NotificationController = require('./notificationController');

// Créer dossiers upload si manquants
const uploadsRoot = path.join(__dirname, '..', 'uploads');
const pendingDir = path.join(uploadsRoot, 'pending_residences');
const residencesDir = path.join(uploadsRoot, 'residences');
if (!fs.existsSync(pendingDir)) fs.mkdirSync(pendingDir, { recursive: true });
if (!fs.existsSync(residencesDir)) fs.mkdirSync(residencesDir, { recursive: true });

// Multer storage pour photos des residences
const storageRes = multer.diskStorage({
  destination: (req, file, cb) => cb(null, residencesDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, unique);
  }
});
const upload = multer({ storage: storageRes });

// Multer storage pour pending
const storagePending = multer.diskStorage({
  destination: (req, file, cb) => cb(null, pendingDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname);
    cb(null, unique);
  }
});
const uploadPending = multer({ storage: storagePending });

class ResidenceController {
  // Lister les résidences
  static async list(req, res) {
    try {
      const fok = req.query.fokontany;
      
      const sql = fok
        ? `
          SELECT r.*, 
                 ARRAY_AGG(DISTINCT '/uploads/residences/' || p.filename) FILTER (WHERE p.filename IS NOT NULL) as photos,
                 COUNT(DISTINCT p.id) as photo_count
          FROM residences r 
          LEFT JOIN photos p ON p.residence_id = r.id 
          WHERE r.fokontany = $1 
          GROUP BY r.id
          ORDER BY r.id DESC
        `
        : `
          SELECT r.*, 
                 ARRAY_AGG(DISTINCT '/uploads/residences/' || p.filename) FILTER (WHERE p.filename IS NOT NULL) as photos,
                 COUNT(DISTINCT p.id) as photo_count
          FROM residences r 
          LEFT JOIN photos p ON p.residence_id = r.id 
          GROUP BY r.id
          ORDER BY r.id DESC
        `;
      
      const result = await pool.query(sql, fok ? [fok] : []);
      
      const residences = result.rows.map(residence => ({
        ...residence,
        photos: residence.photos || []
      }));

      res.json(residences);
    } catch (error) {
      console.error('Erreur récupération résidences:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Créer une résidence avec système d'approbation
  static async create(req, res) {
    const client = await pool.connect();
    try {
      const { lot, quartier, ville, fokontany, lat, lng, created_by, residents, photos, notes } = req.body;
      
      if (!lot || lat == null || lng == null) {
        return res.status(400).json({ error: 'lot, lat et lng requis' });
      }

      const user = req.user;

      await client.query('BEGIN');

      const residenceData = {
        lot, quartier, ville, fokontany, lat, lng, created_by: created_by || user.id,
        residents: Array.isArray(residents) ? residents : [],
        photos: Array.isArray(photos) ? photos : [],
        notes: notes || null
      };

      // Si c'est un agent, mettre en attente d'approbation
      if (user.role === 'agent') {
        const pendingQuery = `
          INSERT INTO pending_residences (residence_data, submitted_by, status, created_at) 
          VALUES ($1, $2, 'pending', NOW()) 
          RETURNING *
        `;
        
        const pendingResult = await client.query(pendingQuery, [JSON.stringify(residenceData), user.id]);
        const pendingId = pendingResult.rows[0].id;

        // Trouver les secrétaires du même fokontany
        const secretariesQuery = `
          SELECT id, nom_complet 
          FROM users 
          WHERE role = 'secretaire' 
          AND fokontany_id = $1 
          AND is_active = TRUE
        `;
        
        const secretariesResult = await client.query(secretariesQuery, [user.fokontany_id]);

        // Créer des notifications pour chaque secrétaire
        for (const secretary of secretariesResult.rows) {
          await NotificationController.createNotification({
            type: 'residence_approval',
            title: 'Nouvelle résidence à approuver',
            message: `L'agent ${user.nom_complet} a ajouté une nouvelle résidence (${lot}) qui nécessite votre approbation.`,
            recipient_id: secretary.id,
            sender_id: user.id,
            related_entity_id: pendingId,
            status: 'pending'
          });
        }

        await client.query('COMMIT');

        res.status(201).json({
          message: 'Résidence soumise pour approbation. Attendez la confirmation du secrétaire.',
          requires_approval: true,
          pending_id: pendingId
        });
      } else {
        // Pour secrétaire et admin, création directe
        const sql = `
          INSERT INTO residences (lot, quartier, ville, fokontany, lat, lng, created_by, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          RETURNING *
        `;
        
        const result = await client.query(sql, [lot, quartier || null, ville || null, fokontany || null, lat, lng, created_by || user.id]);
        const residenceId = result.rows[0].id;

        // Insérer les résidents si fournis
        const residentsToInsert = Array.isArray(residenceData.residents) ? residenceData.residents : [];
        for (const resident of residentsToInsert) {
          const personSql = `
            INSERT INTO persons (residence_id, nom_complet, date_naissance, cin, genre, telephone, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING id
          `;
          const personResult = await client.query(personSql, [
            residenceId, 
            resident.nomComplet, 
            resident.dateNaissance || null, 
            resident.cin || null, 
            resident.genre || 'homme', 
            resident.telephone || null
          ]);
          
          const personId = personResult.rows[0].id;
          
          if (resident.lien_parente || resident.parent_id || resident.famille_id || typeof resident.statut_habitation !== 'undefined') {
            const isProp = resident.statut_habitation === 'proprietaire' ? true : false;
            const relSql = `
              INSERT INTO person_relations (person_id, relation_type, parent_id, is_proprietaire, famille_id)
              VALUES ($1, $2, $3, $4, $5)
            `;
            await client.query(relSql, [
              personId, 
              resident.lien_parente || null, 
              resident.parent_id || null, 
              isProp, 
              resident.famille_id || null
            ]);
          }
        }

        await client.query('COMMIT');
        res.status(201).json(result.rows[0]);
      }
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erreur création résidence:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    } finally {
      client.release();
    }
  }

  // Mettre à jour une résidence
  static async update(req, res) {
    try {
      const id = req.params.id;
      const { lot, quartier, ville } = req.body;
      
      const sql = `
        UPDATE residences 
        SET lot = $1, quartier = $2, ville = $3 
        WHERE id = $4 
        RETURNING *
      `;
      
      const result = await pool.query(sql, [lot, quartier || null, ville || null, id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Résidence non trouvée' });
      }
      
      res.json(result.rows[0]);
    } catch (error) {
      console.error('Erreur mise à jour résidence:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Désactiver une résidence
  static async deactivate(req, res) {
    try {
      const id = req.params.id;
      const sql = `UPDATE residences SET is_active = FALSE WHERE id = $1 RETURNING *`;
      
      const result = await pool.query(sql, [id]);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Résidence non trouvée' });
      }
      
      res.json({ message: 'Résidence désactivée avec succès', residence: result.rows[0] });
    } catch (error) {
      console.error('Erreur désactivation résidence:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Upload de photos
  static async uploadPhotos(req, res) {
    const client = await pool.connect();
    try {
      const residenceId = req.params.id;
      
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Aucun fichier uploadé' });
      }

      await client.query('BEGIN');

      const photos = req.files.map(file => ({
        residence_id: residenceId,
        filename: file.filename
      }));

      // Insérer les photos dans la base de données
      const query = 'INSERT INTO photos (residence_id, filename) VALUES ($1, $2)';
      
      for (const photo of photos) {
        await client.query(query, [photo.residence_id, photo.filename]);
      }

      await client.query('COMMIT');

      // Retourner les URLs des photos
      const photoUrls = photos.map(photo => ({
        url: `/uploads/residences/${photo.filename}`,
        filename: photo.filename
      }));

      res.status(201).json({
        message: 'Photos uploadées avec succès',
        photos: photoUrls
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erreur insertion photos:', error);
      // Supprimer les fichiers uploadés en cas d'erreur
      if (req.files) {
        req.files.forEach(file => {
          try { fs.unlinkSync(file.path); } catch (e) {}
        });
      }
      res.status(500).json({ error: 'Erreur enregistrement photos' });
    } finally {
      client.release();
    }
  }

  // Récupérer les photos d'une résidence
  static async getPhotos(req, res) {
    try {
      const residenceId = req.params.id;
      
      const query = `
        SELECT id, filename, created_at 
        FROM photos 
        WHERE residence_id = $1 
        ORDER BY created_at DESC
      `;
      
      const result = await pool.query(query, [residenceId]);
      
      const photos = result.rows.map(photo => ({
        ...photo,
        url: `/uploads/residences/${photo.filename}`
      }));

      res.json(photos);
    } catch (error) {
      console.error('Erreur récupération photos:', error);
      res.status(500).json({ error: 'Erreur récupération photos' });
    }
  }

  // Supprimer une photo
  static async deletePhoto(req, res) {
    const client = await pool.connect();
    try {
      const { id, photoId } = req.params;
      
      await client.query('BEGIN');

      // Récupérer le nom du fichier avant suppression
      const getQuery = 'SELECT filename FROM photos WHERE id = $1 AND residence_id = $2';
      const getResult = await client.query(getQuery, [photoId, id]);
      
      if (getResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Photo non trouvée' });
      }

      const filename = getResult.rows[0].filename;
      const filePath = path.join(__dirname, '../uploads/residences', filename);

      // Supprimer de la base de données
      const deleteQuery = 'DELETE FROM photos WHERE id = $1 AND residence_id = $2';
      await client.query(deleteQuery, [photoId, id]);

      await client.query('COMMIT');

      // Supprimer le fichier physique
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (unlinkErr) {
        console.error('Erreur suppression fichier:', unlinkErr);
      }
      
      res.json({ message: 'Photo supprimée avec succès' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erreur suppression photo:', error);
      res.status(500).json({ error: 'Erreur suppression photo' });
    } finally {
      client.release();
    }
  }

  // Récupérer les résidences en attente d'approbation
  static async getPendingResidences(req, res) {
    try {
      const user = req.user;
      
      if (!['secretaire', 'admin'].includes(user.role)) {
        return res.status(403).json({ error: 'Accès non autorisé' });
      }

      let query = `
        SELECT pr.*, 
               u.nom_complet as submitter_name,
               u.immatricule as submitter_immatricule,
               f.nom as fokontany_nom
        FROM pending_residences pr
        JOIN users u ON pr.submitted_by = u.id
        LEFT JOIN fokontany f ON u.fokontany_id = f.id
        WHERE pr.status = 'pending'
      `;

      let params = [];
      if (user.role === 'secretaire') {
        query += ' AND u.fokontany_id = $1';
        params.push(user.fokontany_id);
      }

      query += ' ORDER BY pr.created_at DESC';

      const result = await pool.query(query, params);

      // Parser les données JSON
      const pendingResidences = result.rows.map(row => ({
        ...row,
        residence_data: typeof row.residence_data === 'string' ? JSON.parse(row.residence_data) : row.residence_data
      }));

      res.json(pendingResidences);
    } catch (error) {
      console.error('Erreur récupération résidences en attente:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Approuver une résidence en attente
  static async approveResidence(req, res) {
    const client = await pool.connect();
    try {
      const pendingId = parseInt(req.params.pendingId, 10);
      const user = req.user;

      if (!pendingId) {
        return res.status(400).json({ error: 'pendingId manquant' });
      }

      await client.query('BEGIN');

      // Récupérer la demande en attente
      const pendingResult = await client.query('SELECT * FROM pending_residences WHERE id = $1 FOR UPDATE', [pendingId]);
      if (pendingResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pending non trouvé' });
      }

      const pending = pendingResult.rows[0];
      const residenceData = typeof pending.residence_data === 'string' ? JSON.parse(pending.residence_data) : pending.residence_data;

      // Vérifier l'autorisation
      if (user.role === 'agent' && user.id !== pending.submitted_by) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Accès non autorisé' });
      }

      // Insérer la résidence
      const insertResidenceSql = `
        INSERT INTO residences (lot, quartier, ville, fokontany, lat, lng, created_by, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        RETURNING *
      `;
      
      const residenceResult = await client.query(insertResidenceSql, [
        residenceData.lot || null,
        residenceData.quartier || null,
        residenceData.ville || null,
        residenceData.fokontany || null,
        residenceData.lat || null,
        residenceData.lng || null,
        user.id || residenceData.created_by || null
      ]);
      
      const residenceId = residenceResult.rows[0].id;

      // Insérer les personnes et relations
      const residents = Array.isArray(residenceData.residents) ? residenceData.residents : [];
      for (const resident of residents) {
        const personResult = await client.query(
          `INSERT INTO persons (residence_id, nom_complet, date_naissance, cin, genre, telephone, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           RETURNING id`,
          [
            residenceId, 
            resident.nom_complet || resident.nomComplet || null, 
            resident.date_naissance || resident.dateNaissance || null, 
            resident.cin || null, 
            resident.genre || resident.sexe || 'homme', 
            resident.telephone || null
          ]
        );
        
        const personId = personResult.rows[0].id;

        if (resident.lien_parente || resident.parent_id || resident.famille_id || typeof resident.statut_habitation !== 'undefined') {
          const isProp = (resident.statut_habitation === 'proprietaire' || resident.is_proprietaire) ? true : false;
          await client.query(
            `INSERT INTO person_relations (person_id, relation_type, parent_id, is_proprietaire, famille_id, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [
              personId, 
              resident.lien_parente || resident.relation_type || null, 
              resident.parent_id || null, 
              isProp, 
              resident.famille_id || null
            ]
          );
        }
      }

      // Gérer les photos
      const pendingPhotos = Array.isArray(residenceData.photos) ? residenceData.photos : [];
      const movedFilenames = [];
      
      for (const photo of pendingPhotos) {
        const filename = (typeof photo === 'string') ? photo.split('/').pop() : null;
        if (!filename) continue;

        const pendingPath = path.join(pendingDir, filename);
        if (fs.existsSync(pendingPath)) {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const destFilename = `residence-${uniqueSuffix}${path.extname(filename)}`;
          const destPath = path.join(residencesDir, destFilename);

          try {
            fs.renameSync(pendingPath, destPath);
            movedFilenames.push(destFilename);
          } catch (renameErr) {
            try {
              fs.copyFileSync(pendingPath, destPath);
              fs.unlinkSync(pendingPath);
              movedFilenames.push(destFilename);
            } catch (copyErr) {
              console.error('Erreur déplacement fichier:', copyErr);
            }
          }
        }
      }

      // Insérer les photos déplacées
      for (const filename of movedFilenames) {
        await client.query('INSERT INTO photos (residence_id, filename) VALUES ($1, $2)', [residenceId, filename]);
      }

      // Mettre à jour le statut de la demande
      await client.query(
        `UPDATE pending_residences SET status = 'approved', reviewed_by = $1, review_notes = $2, updated_at = NOW() WHERE id = $3`,
        [user.id, req.body.review_notes || null, pendingId]
      );

      // Créer une notification pour le demandeur
      try {
        await NotificationController.createNotification({
          type: 'residence_approval',
          title: 'Résidence approuvée',
          message: `Votre résidence (${residenceData.lot || 'sans lot'}) a été approuvée.`,
          recipient_id: pending.submitted_by,
          sender_id: user.id,
          related_entity_id: residenceId,
          status: 'approved'
        });
      } catch (notifErr) {
        console.warn('Impossible de créer notification:', notifErr);
      }

      await client.query('COMMIT');

      res.json({ 
        message: 'Résidence approuvée avec succès', 
        residence: residenceResult.rows[0], 
        approved: true 
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erreur approbation résidence:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    } finally {
      client.release();
    }
  }

  // Rejeter une résidence en attente
  static async rejectResidence(req, res) {
    const client = await pool.connect();
    try {
      const pendingId = parseInt(req.params.pendingId, 10);
      const user = req.user;
      const review_notes = req.body.review_notes || null;

      if (!pendingId) {
        return res.status(400).json({ error: 'pendingId manquant' });
      }

      await client.query('BEGIN');

      // Récupérer la demande
      const pendingResult = await client.query('SELECT * FROM pending_residences WHERE id = $1 FOR UPDATE', [pendingId]);
      if (pendingResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pending non trouvé' });
      }

      const pending = pendingResult.rows[0];

      // Vérifier l'autorisation
      if (user.role === 'agent' && user.id !== pending.submitted_by) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Accès non autorisé' });
      }

      // Mettre à jour le statut
      await client.query(
        `UPDATE pending_residences SET status = 'rejected', reviewed_by = $1, review_notes = $2, updated_at = NOW() WHERE id = $3`,
        [user.id, review_notes, pendingId]
      );

      // Supprimer les fichiers en attente
      try {
        const residenceData = typeof pending.residence_data === 'string' ? JSON.parse(pending.residence_data) : pending.residence_data;
        const pendingPhotos = Array.isArray(residenceData.photos) ? residenceData.photos : [];
        
        for (const photo of pendingPhotos) {
          const filename = (typeof photo === 'string') ? photo.split('/').pop() : null;
          if (!filename) continue;
          
          const filePath = path.join(pendingDir, filename);
          try { 
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
            }
          } catch (e) {
            console.warn('Impossible de supprimer fichier pending:', filePath, e);
          }
        }
      } catch (e) {
        console.warn('Erreur suppression fichiers pending après rejet:', e);
      }

      // Notifier le demandeur
      try {
        await NotificationController.createNotification({
          type: 'residence_approval',
          title: 'Résidence rejetée',
          message: `Votre résidence a été rejetée. ${review_notes ? 'Motif: ' + review_notes : ''}`,
          recipient_id: pending.submitted_by,
          sender_id: user.id,
          related_entity_id: null,
          status: 'rejected'
        });
      } catch (notifErr) {
        console.warn('Impossible de créer notification rejet:', notifErr);
      }

      await client.query('COMMIT');

      res.json({ message: 'Pending rejeté avec succès', rejected: true });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erreur rejet résidence:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    } finally {
      client.release();
    }
  }
}

module.exports = { ResidenceController, upload, uploadPending };