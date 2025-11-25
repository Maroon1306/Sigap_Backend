const express = require('express');
const router = express.Router();
const PersonController = require('../controllers/personController');
const auth = require('../middleware/auth');
const authorize = require('../middleware/role');

router.post('/', auth, PersonController.createPerson);
router.get('/', auth, PersonController.getAllPersons);
router.get('/:id', auth, PersonController.getPerson);
router.put('/:id', auth, PersonController.updatePerson);
router.delete('/:id', auth, authorize('admin'), PersonController.deletePerson);

module.exports = router;