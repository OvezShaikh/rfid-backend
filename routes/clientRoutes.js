const express = require('express');
const router = express.Router();
const clientController = require('../controllers/clientController');
const { verifyToken } = require('../middleware/authMiddleware'); // Your existing JWT middleware

// ✅ Inline check: Only allows Super Admin (Role 1)
const requireSuperAdmin = (req, res, next) => {
  if (req.user?.role_id !== 1) {
    return res.status(403).json({ error: 'Access denied. Super Admin privileges required.' });
  }
  next();
};

// Apply the token check and the role check to ALL routes in this file
router.use(verifyToken, requireSuperAdmin);

router.get('/', clientController.getClients);
router.post('/', clientController.createClient);
router.delete('/:id', clientController.deleteClient);

module.exports = router;