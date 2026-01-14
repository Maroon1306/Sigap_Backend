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
  // Lister les résidences - CORRIGÉ pour retourner URLs complètes
  static async list(req, res) {
    try {
      const fok = req.query.fokontany;
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      
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
      
      const residences = result.rows.map(residence => {
        // Transformer les chemins relatifs en URLs complètes
        const photos = (residence.photos || []).map(photo => {
          if (photo && photo.startsWith('/uploads/residences/')) {
            return `${baseUrl}${photo}`;
          }
          return photo;
        });
        
        return {
          ...residence,
          photos: photos
        };
      });

      res.json(residences);
    } catch (error) {
      console.error('Erreur récupération résidences:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Créer une résidence avec système d'approbation - CORRIGÉ
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
            message: `${lot} : ${user.nom_complet} `,
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
      
      // Gestion spécifique de l'erreur de clé dupliquée
      if (error.code === '23505') {
        return res.status(500).json({ 
          error: 'Erreur de base de données. Veuillez réessayer.',
          details: 'Problème de séquence de clé primaire'
        });
      }
      
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

  // Upload de photos - CORRIGÉ pour retourner URLs complètes
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

      // Retourner les URLs complètes des photos
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const photoUrls = photos.map(photo => ({
        id: Date.now(), // ID temporaire
        filename: photo.filename,
        url: `${baseUrl}/uploads/residences/${photo.filename}`,
        created_at: new Date().toISOString()
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

  // Récupérer les photos d'une résidence - CORRIGÉ pour retourner URLs complètes
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
      
      // Construire les URLs complètes
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const photos = result.rows.map(photo => ({
        id: photo.id,
        filename: photo.filename,
        url: `${baseUrl}/uploads/residences/${photo.filename}`,
        created_at: photo.created_at
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

  // ============================================
  // NOUVELLES MÉTHODES POUR PHOTOS PENDING
  // ============================================

  // Upload de photos pour pending residences (fichiers)
  static async uploadPendingPhotos(req, res) {
    const client = await pool.connect();
    try {
      const pendingId = req.params.pendingId;
      
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Aucun fichier uploadé' });
      }

      await client.query('BEGIN');

      // Récupérer les données existantes du pending
      const pendingResult = await client.query(
        'SELECT * FROM pending_residences WHERE id = $1 FOR UPDATE',
        [pendingId]
      );
      
      if (pendingResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Résidence en attente non trouvée' });
      }

      const pending = pendingResult.rows[0];
      let residenceData = typeof pending.residence_data === 'string' 
        ? JSON.parse(pending.residence_data) 
        : pending.residence_data;

      // Construire les URLs des nouvelles photos
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const newPhotos = [];
      
      for (const file of req.files) {
        const photoUrl = `${baseUrl}/uploads/pending_residences/${file.filename}`;
        newPhotos.push(photoUrl);
      }

      // Ajouter les nouvelles photos aux données existantes
      if (!residenceData.photos) {
        residenceData.photos = [];
      }
      
      residenceData.photos = [...residenceData.photos, ...newPhotos];

      // Mettre à jour les données dans pending_residences
      await client.query(
        'UPDATE pending_residences SET residence_data = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(residenceData), pendingId]
      );

      await client.query('COMMIT');

      // Retourner les informations des photos uploadées
      const responsePhotos = req.files.map((file, index) => ({
        id: Date.now() + index,
        filename: file.filename,
        url: `${baseUrl}/uploads/pending_residences/${file.filename}`,
        created_at: new Date().toISOString()
      }));

      res.status(201).json({
        message: 'Photos uploadées avec succès pour la résidence en attente',
        photos: responsePhotos
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erreur upload photos pending:', error);
      
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

  // Upload de photos base64 pour pending residences
  static async uploadPendingPhotosBase64(req, res) {
    const client = await pool.connect();
    try {
      const pendingId = req.params.pendingId;
      const { photos: photosBase64 } = req.body;
      
      if (!photosBase64 || !Array.isArray(photosBase64) || photosBase64.length === 0) {
        return res.status(400).json({ error: 'Aucune photo base64 fournie' });
      }

      await client.query('BEGIN');

      // Récupérer les données existantes du pending
      const pendingResult = await client.query(
        'SELECT * FROM pending_residences WHERE id = $1 FOR UPDATE',
        [pendingId]
      );
      
      if (pendingResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Résidence en attente non trouvée' });
      }

      const pending = pendingResult.rows[0];
      let residenceData = typeof pending.residence_data === 'string' 
        ? JSON.parse(pending.residence_data) 
        : pending.residence_data;

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const newPhotos = [];

      // Sauvegarder chaque base64 en fichier
      for (let i = 0; i < photosBase64.length; i++) {
        const base64Data = photosBase64[i];
        
        if (!base64Data || typeof base64Data !== 'string') {
          continue;
        }

        let imageBuffer;
        let extension = 'jpg';
        
        if (base64Data.startsWith('data:image/')) {
          const matches = base64Data.match(/^data:image\/([A-Za-z-+/]+);base64,(.+)$/);
          if (!matches || matches.length !== 3) {
            continue;
          }

          extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
          imageBuffer = Buffer.from(matches[2], 'base64');
        } else {
          try {
            imageBuffer = Buffer.from(base64Data, 'base64');
          } catch (e) {
            console.warn('Base64 invalide:', e);
            continue;
          }
        }

        const filename = `pending-${pendingId}-${Date.now()}-${i}.${extension}`;
        const filePath = path.join(pendingDir, filename);
        
        try {
          fs.writeFileSync(filePath, imageBuffer);
          const photoUrl = `${baseUrl}/uploads/pending_residences/${filename}`;
          newPhotos.push(photoUrl);
        } catch (writeErr) {
          console.error('Erreur écriture fichier:', writeErr);
        }
      }

      // Ajouter les nouvelles photos aux données existantes
      if (!residenceData.photos) {
        residenceData.photos = [];
      }
      
      residenceData.photos = [...residenceData.photos, ...newPhotos];

      // Mettre à jour les données dans pending_residences
      await client.query(
        'UPDATE pending_residences SET residence_data = $1, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(residenceData), pendingId]
      );

      await client.query('COMMIT');

      // Préparer la réponse
      const responsePhotos = newPhotos.map((url, index) => ({
        id: Date.now() + index,
        filename: url.split('/').pop(),
        url: url,
        created_at: new Date().toISOString()
      }));

      res.status(201).json({
        message: 'Photos base64 uploadées avec succès',
        photos: responsePhotos
      });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Erreur upload base64 photos pending:', error);
      res.status(500).json({ error: 'Erreur enregistrement photos base64' });
    } finally {
      client.release();
    }
  }

  // Récupérer les photos d'une pending residence
  static async getPendingPhotos(req, res) {
    try {
      const pendingId = req.params.pendingId;
      
      const pendingResult = await pool.query(
        'SELECT residence_data FROM pending_residences WHERE id = $1',
        [pendingId]
      );
      
      if (pendingResult.rows.length === 0) {
        return res.status(404).json({ error: 'Résidence en attente non trouvée' });
      }

      const pending = pendingResult.rows[0];
      const residenceData = typeof pending.residence_data === 'string' 
        ? JSON.parse(pending.residence_data) 
        : pending.residence_data;

      const photos = Array.isArray(residenceData.photos) ? residenceData.photos : [];
      
      const formattedPhotos = photos.map((url, index) => ({
        id: index + 1,
        url: url,
        filename: url.split('/').pop(),
        created_at: new Date().toISOString()
      }));

      res.json(formattedPhotos);
    } catch (error) {
      console.error('Erreur récupération photos pending:', error);
      res.status(500).json({ error: 'Erreur récupération photos' });
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

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const pendingResidences = result.rows.map(row => {
        const residenceData = typeof row.residence_data === 'string' ? JSON.parse(row.residence_data) : row.residence_data;
        
        if (Array.isArray(residenceData.photos)) {
          residenceData.photos = residenceData.photos.map(photo => {
            if (photo && photo.startsWith('pending_residences/')) {
              return `${baseUrl}/uploads/${photo}`;
            }
            return photo;
          });
        }
        
        return {
          ...row,
          residence_data: residenceData
        };
      });

      res.json(pendingResidences);
    } catch (error) {
      console.error('Erreur récupération résidences en attente:', error);
      res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Approuver une résidence en attente - AMÉLIORÉ avec logs
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

      // Gérer les photos avec logs améliorés
      const pendingPhotos = Array.isArray(residenceData.photos) ? residenceData.photos : [];
      const movedFilenames = [];
      
      console.log(`🔄 Migration de ${pendingPhotos.length} photos pour pending ${pendingId}`);
      
      for (const photo of pendingPhotos) {
        const filename = (typeof photo === 'string') ? photo.split('/').pop() : null;
        if (!filename) continue;

        const pendingPath = path.join(pendingDir, filename);
        console.log(`📁 Vérification fichier: ${pendingPath} (existe: ${fs.existsSync(pendingPath)})`);
        
        if (fs.existsSync(pendingPath)) {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const destFilename = `residence-${uniqueSuffix}${path.extname(filename)}`;
          const destPath = path.join(residencesDir, destFilename);

          try {
            fs.renameSync(pendingPath, destPath);
            movedFilenames.push(destFilename);
            console.log(`✅ Photo migrée: ${filename} → ${destFilename}`);
          } catch (renameErr) {
            try {
              fs.copyFileSync(pendingPath, destPath);
              fs.unlinkSync(pendingPath);
              movedFilenames.push(destFilename);
              console.log(`✅ Photo copiée: ${filename} → ${destFilename}`);
            } catch (copyErr) {
              console.error('❌ Erreur déplacement fichier:', copyErr);
            }
          }
        } else {
          console.warn(`⚠️ Fichier non trouvé: ${pendingPath}`);
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
        
        console.log(`🗑️  Suppression de ${pendingPhotos.length} photos pour pending rejeté ${pendingId}`);
        
        for (const photo of pendingPhotos) {
          const filename = (typeof photo === 'string') ? photo.split('/').pop() : null;
          if (!filename) continue;
          
          const filePath = path.join(pendingDir, filename);
          try { 
            if (fs.existsSync(filePath)) {
              fs.unlinkSync(filePath);
              console.log(`✅ Fichier supprimé: ${filePath}`);
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