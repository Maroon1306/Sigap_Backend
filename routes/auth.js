const express = require('express');
const router = express.Router();
const { AuthController, upload } = require('../controllers/authController');
const auth = require('../middleware/auth');
const authorize = require('../middleware/role');

router.post('/login', AuthController.login);
router.get('/me', auth, AuthController.getCurrentUser);
router.post('/upload-photo', auth, upload.single('photo'), AuthController.uploadProfilePhoto);
router.post('/change-password', auth, AuthController.changePassword);
router.post('/forgot-password', AuthController.requestPasswordReset);
router.get('/reset-requests', auth, authorize('admin'), AuthController.getPendingResetRequests);
router.get('/password-change-requests', auth, authorize('admin'), AuthController.getPendingPasswordChangeRequests);
router.post('/approve-reset', auth, authorize('admin'), AuthController.approvePasswordReset);
router.post('/approve-password-change', auth, authorize('admin'), AuthController.approvePasswordChange);
router.post('/invalidate-password', auth, authorize('admin'), AuthController.invalidatePassword);

module.exports = router;