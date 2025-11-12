const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/authController');
const auth = require('../middleware/auth');
const authorize = require('../middleware/role');

router.post('/login', AuthController.login);
router.post('/forgot-password', AuthController.requestPasswordReset);
router.get('/reset-requests', auth, authorize('admin'), AuthController.getPendingResetRequests);
router.post('/approve-reset', auth, authorize('admin'), AuthController.approvePasswordReset);
router.post('/invalidate-password', auth, authorize('admin'), AuthController.invalidatePassword);

module.exports = router;