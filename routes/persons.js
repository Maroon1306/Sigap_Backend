const express = require('express');
const router = express.Router();
const PersonController = require('../controllers/personController');

router.get('/', PersonController.list);
router.post('/', PersonController.create);
router.put('/:id', PersonController.update);
router.delete('/:id', PersonController.remove);

module.exports = router;