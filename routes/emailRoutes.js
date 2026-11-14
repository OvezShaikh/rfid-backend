// routes/emailRoutes.js
const express = require('express');
const router = express.Router();
const emailController         = require('../controllers/emailController');
const emailGroupController    = require('../controllers/emailGroupController');
const emailTemplateController = require('../controllers/emailTemplateController');
const emailLogController      = require('../controllers/emailLogController');

// Legacy recipients (existing card)
router.get('/email-settings',  emailController.getSettings);
router.post('/email-settings', emailController.saveSettings);
router.post('/email-settings/send', emailController.sendReport);

// Groups
router.get('/email-groups',                            emailGroupController.list);
router.post('/email-groups',                           emailGroupController.create);
router.put('/email-groups/:id',                        emailGroupController.update);
router.delete('/email-groups/:id',                     emailGroupController.remove);
router.post('/email-groups/:id/members',               emailGroupController.addMember);
router.delete('/email-groups/:id/members/:email',      emailGroupController.removeMember);

// Templates
router.get('/email-templates',    emailTemplateController.list);
router.put('/email-templates/:id', emailTemplateController.update);

// Log + test
router.get('/email-log',          emailLogController.list);
router.post('/email-trigger/test', emailLogController.testTrigger);

// Retry a failed email log entry
router.post('/email-log/:id/retry', emailLogController.retry);

module.exports = router;