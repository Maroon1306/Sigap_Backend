const express = require('express');
const router = express.Router();
const UserController = require('../controllers/userController');
const auth = require('../middleware/auth');
const authorize = require('../middleware/role');

router.post('/', auth, authorize('admin'), UserController.createUser);
router.get('/', auth, authorize('admin'), UserController.getAllUsers);
router.put('/:id', auth, authorize('admin'), UserController.updateUser);
router.delete('/:id', auth, authorize('admin'), UserController.deleteUser);
router.patch('/:id/deactivate', auth, authorize('admin'), UserController.deactivateUser);

module.exports = router;