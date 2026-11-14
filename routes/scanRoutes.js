const express = require('express');
const router = express.Router();
const scanController = require('../controllers/scanController');

router.post('/dispatch', scanController.dispatchScan);
router.post('/receive', scanController.receiveScan);
router.post('/return', scanController.returnScan);
router.post('/unified', scanController.unifiedScan);
router.post('/receive-bulk', scanController.bulkReceive);
router.post('/return-bulk', scanController.bulkReturn);

module.exports = router;