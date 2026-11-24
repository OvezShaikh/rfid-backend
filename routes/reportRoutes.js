const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

// Only Super Admin (1) and Admin (2) can view reports
router.use(verifyToken);
router.use(requireRole([1, 2])); 

router.get('/turnaround', reportController.getTurnaroundTime);
router.get('/location-stock', reportController.getLocationStock);
router.get('/exception-rate', reportController.getExceptionRate);

// Stuck in Transit, Daily Movement, and Audit Exceptions are accessible to all authenticated users
router.get('/stuck-in-transit', reportController.getStuckInTransit);
router.get('/daily-movement', reportController.getDailyMovement);
router.get('/audit-exceptions', reportController.getAuditExceptions);

module.exports = router;