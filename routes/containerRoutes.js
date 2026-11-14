const express = require('express');
const router = express.Router();
const containerController = require('../controllers/containerController');

router.post('/assemble', containerController.assembleSet);
router.get('/', containerController.getContainers);
router.get('/:setId', containerController.getContainerById);
router.patch('/:setId', containerController.disassembleSet);

module.exports = router;