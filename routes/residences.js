const express = require('express');
const router = express.Router();
const ResidenceController = require('../controllers/residenceController');
const auth = require('../middleware/auth');
const authorize = require('../middleware/role');

router.post('/pending', auth, ResidenceController.submitPendingResidence);
router.get('/pending', auth, authorize('admin'), ResidenceController.getPendingResidences);
router.post('/pending/:id/approve', auth, authorize('admin'), ResidenceController.approvePendingResidence);
router.post('/pending/:id/reject', auth, authorize('admin'), ResidenceController.rejectPendingResidence);

router.get('/', auth, ResidenceController.getResidences);
router.get('/:id', auth, ResidenceController.getResidenceById);
router.put('/:id', auth, authorize('admin'), ResidenceController.updateResidence);
router.delete('/:id', auth, authorize('admin'), ResidenceController.deleteResidence);

module.exports = router;