const express = require('express');
const router = express.Router();
const assetController = require('../controllers/assetController');
const historyController = require('../controllers/historyController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

// Apply verifyToken to EVERY route in this file automatically
router.use(verifyToken);

// ═══════════════════════════════════════════════════════════════
// 1. STATIC ROUTES & ROOT (Must come before /:id)
// ═══════════════════════════════════════════════════════════════

// Get All Assets (THIS WAS MISSING - FIXES THE 404)
router.get('/', assetController.getAssets);

// Create Asset (Super Admin & Admin only)
router.post('/', requireRole([1, 2]), assetController.createAsset);

router.post('/bulk', requireRole([1, 2]), assetController.bulkCreateAssets);

// Admin Stats
router.get('/admin/stats', assetController.getAdminStats);

// Exceptions
router.get('/exceptions', assetController.getExceptions);
router.put('/exceptions/:id/resolve', requireRole([1, 2]), assetController.resolveException);

// Containers (Admin view)
router.get('/containers', assetController.getContainers);

// History (Must be above /:id)
router.get('/history/set/:setId', historyController.getSetHistory);
router.get('/history/:assetId', historyController.getAssetHistory);
router.get('/scan-trend', historyController.getScanTrend);


// ═══════════════════════════════════════════════════════════════
// 2. PARAM ROUTES (Must come LAST)
// ═══════════════════════════════════════════════════════════════

router.get('/:id', assetController.getAssetById);
router.put('/:id', requireRole([1, 2]), assetController.updateAsset);
router.delete('/:id', requireRole([1]), assetController.deleteAsset);

module.exports = router;