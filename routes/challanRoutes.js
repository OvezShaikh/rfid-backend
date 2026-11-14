const express = require('express');
const router = express.Router();
const challanController = require('../controllers/challanController');

router.post('/', challanController.createChallan);
router.get('/', challanController.getAllChallans);
router.get('/:id', challanController.getChallanById);

module.exports = router;