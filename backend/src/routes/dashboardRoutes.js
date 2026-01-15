// Dashboard Routes
const express = require('express');
const router = express.Router();
const dashboardController = require('../controllers/dashboardController');
const {authenticate} = require('../middleware/auth');

router.get('/summary', authenticate, dashboardController.getDashboardSummary);
router.get('/patient-tasks', authenticate, dashboardController.getPatientTasks);

module.exports = router;
