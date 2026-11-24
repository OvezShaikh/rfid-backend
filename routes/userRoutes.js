const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { verifyToken, requireRole } = require('../middleware/authMiddleware');

// Apply to all routes in this file: Must be logged in AND be Super Admin (Role 1)
router.use(verifyToken);
router.use(requireRole([1]));

router.get('/', userController.getUsers);
router.post('/', userController.createUser);
router.put('/:id', userController.updateUser);
router.delete('/:id', userController.deleteUser);
router.put('/profile', verifyToken, userController.updateOwnProfile);
router.put('/password', verifyToken, userController.updateOwnPassword);

module.exports = router;