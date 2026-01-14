const express = require('express');
const router = express.Router();
const { ResidenceController, upload, uploadPending } = require('../controllers/residenceController');
const auth = require('../middleware/auth');

router.get('/', ResidenceController.list);
router.post('/', auth, ResidenceController.create);
router.put('/:id', auth, ResidenceController.update);
router.patch('/:id/deactivate', auth, ResidenceController.deactivate);

router.post('/:id/photos', auth, upload.array('photos', 10), ResidenceController.uploadPhotos);
router.get('/:id/photos', ResidenceController.getPhotos);
router.delete('/:id/photos/:photoId', auth, ResidenceController.deletePhoto);

// ============================================
// NOUVELLES ROUTES POUR PHOTOS PENDING RESIDENCES
// ============================================

// Upload de fichiers pour pending residences
router.post('/pending/:pendingId/photos', auth, uploadPending.array('photos', 10), ResidenceController.uploadPendingPhotos);

// Upload base64 pour pending residences
router.post('/pending/:pendingId/photos-base64', auth, ResidenceController.uploadPendingPhotosBase64);

// Récupérer les photos d'une pending residence
router.get('/pending/:pendingId/photos', auth, ResidenceController.getPendingPhotos);

module.exports = router;