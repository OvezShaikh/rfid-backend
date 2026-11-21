const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');
const { requireRole } = require('../middleware/authMiddleware');

router.get('/', deviceController.getDevices);
router.get('/:id', deviceController.getDeviceById);
router.post('/', requireRole([1]), deviceController.createDevice);

module.exports = router;