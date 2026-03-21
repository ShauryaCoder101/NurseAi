const express = require('express');
const router = express.Router();
const doctorController = require('../controllers/doctorController');
const patientRecordController = require('../controllers/patientRecordController');
const {authenticateDoctor} = require('../middleware/doctorAuth');

// Auth
router.post('/login', doctorController.loginDoctor);

// Protected routes
router.use(authenticateDoctor);

// Get visits grouped by status
router.get('/visits', doctorController.getVisits);

// Verify a specific visit
router.post('/verify/:id', doctorController.verifyVisit);

// Get Patient HTML file (for iframe)
router.get('/patient-record/:patientId/html', patientRecordController.getPatientRecordHtml);
router.get('/patient-record/:patientId/visit/:transcriptId/html', patientRecordController.getVisitRecordHtml);

module.exports = router;
