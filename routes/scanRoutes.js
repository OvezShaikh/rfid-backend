const express = require('express');
const router = express.Router();
const scanController = require('../controllers/scanController');

router.post('/dispatch', scanController.dispatchScan);

module.exports = router;