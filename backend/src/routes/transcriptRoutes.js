// Transcript Routes
const express = require('express');
const router = express.Router();
const transcriptController = require('../controllers/transcriptController');
const {authenticate} = require('../middleware/auth');

router.get('/', authenticate, transcriptController.getTranscripts);
router.get('/:id', authenticate, transcriptController.getTranscript);
router.post('/', authenticate, transcriptController.saveTranscript);

module.exports = router;
