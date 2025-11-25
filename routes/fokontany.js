const express = require('express');
const router = express.Router();
const FokontanyController = require('../controllers/fokontanyController');
const auth = require('../middleware/auth');

router.get('/', auth, FokontanyController.getAllFokontany);
router.get('/region/:region', auth, FokontanyController.getFokontanyByRegion);
router.get('/user-location', auth, FokontanyController.getFokontanyByUserLocation);
router.get('/search', auth, FokontanyController.searchFokontany);
router.post('/create-test', auth, FokontanyController.createTestFokontany);
router.get('/me', auth, FokontanyController.getMyFokontany);

module.exports = router;