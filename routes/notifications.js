const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/notificationController');
const auth = require('../middleware/auth');
const authorize = require('../middleware/role');

router.post('/', auth, NotificationController.createNotification);
router.get('/', auth, NotificationController.getNotificationsForUser);
router.patch('/:id/read', auth, NotificationController.markAsRead);
router.patch('/:id/status', auth, authorize('admin'), NotificationController.updateNotificationStatus);

module.exports = router;