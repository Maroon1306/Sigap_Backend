const express = require('express');
const router = express.Router();
const { ResidenceController, upload } = require('../controllers/residenceController');
const auth = require('../middleware/auth');

router.get('/', ResidenceController.list);
router.post('/', auth, ResidenceController.create);
router.put('/:id', auth, ResidenceController.update);
router.patch('/:id/deactivate', auth, ResidenceController.deactivate);

router.post('/:id/photos', auth, upload.array('photos', 10), ResidenceController.uploadPhotos);
router.get('/:id/photos', ResidenceController.getPhotos);
router.delete('/:id/photos/:photoId', auth, ResidenceController.deletePhoto);

module.exports = router;
