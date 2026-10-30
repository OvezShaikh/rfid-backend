const express = require('express');
const router = express.Router();
const assetController = require('../controllers/assetController');

router.post('/', assetController.createAsset);
router.get('/', assetController.getAssets);

// Static routes FIRST
router.get('/exceptions', assetController.getExceptions);
router.get('/containers', assetController.getContainers);

// Param routes LAST
router.get('/:id', assetController.getAssetById);
router.put('/:id', assetController.updateAsset);
router.delete('/:id', assetController.deleteAsset);

module.exports = router;