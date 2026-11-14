const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');

router.get('/', deviceController.getDevices);
router.get('/:id', deviceController.getDeviceById);
router.post('/', deviceController.createDevice);

module.exports = router;