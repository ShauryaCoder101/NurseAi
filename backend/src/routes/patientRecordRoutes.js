// Patient Record Routes
const express = require('express');
const router = express.Router();
const patientRecordController = require('../controllers/patientRecordController');
const {authenticate} = require('../middleware/auth');

router.get('/:patientId/check', authenticate, patientRecordController.checkPatientExists);
router.get('/:patientId/html', authenticate, patientRecordController.getPatientRecordHtml);
router.get('/:patientId', authenticate, patientRecordController.getPatientRecord);

module.exports = router;
