const express = require('express');
const router = express.Router();
const doctorController = require('../controllers/doctorController');
const patientRecordController = require('../controllers/patientRecordController');
const {authenticateDoctor} = require('../middleware/doctorAuth');

// Auth
router.post('/login', doctorController.loginDoctor);

// Audio stream proxy — BEFORE auth (iframe <audio> tags can't send JWT headers)
// Security: audio record IDs are UUIDs (unguessable)
router.get('/audio/:audioRecordId', doctorController.streamAudio);

// Protected routes
router.use(authenticateDoctor);

// Get visits grouped by status
router.get('/visits', doctorController.getVisits);

// Verify a specific visit
router.post('/verify/:id', doctorController.verifyVisit);

// Get Patient HTML file (for iframe)
router.get('/patient-record/:patientId/html', patientRecordController.getPatientRecordHtml);
router.get('/patient-record/:patientId/visit/:transcriptId/html', patientRecordController.getVisitRecordHtml);

// Benchmarking page endpoints
router.get('/benchmarking/cases', doctorController.getBenchmarkingCases);
router.post('/benchmarking/transcribe/:audioId', doctorController.transcribeAudio);
router.post('/benchmarking/evaluate', doctorController.saveEvaluation);
router.get('/benchmarking/evaluations/:audioRecordId', doctorController.getEvaluations);
router.post('/benchmarking/submit', doctorController.submitEvaluation);
router.get('/benchmarking/completed', doctorController.getCompletedCases);

module.exports = router;
