// Transcript Routes
const express = require('express');
const router = express.Router();
const transcriptController = require('../controllers/transcriptController');
const {authenticate} = require('../middleware/auth');

router.get('/', authenticate, transcriptController.getTranscripts);
router.get('/gemini-latest', authenticate, transcriptController.getLatestGeminiSuggestion);
router.get('/gemini-suggestions', authenticate, transcriptController.getGeminiSuggestions);
router.post('/:id/followup', authenticate, transcriptController.followupGeminiSuggestion);
router.post('/:id/flag', authenticate, transcriptController.flagGeminiSuggestion);
router.patch('/:id/missing-data', authenticate, transcriptController.updateGeminiMissingData);
router.patch('/:id/complete', authenticate, transcriptController.markGeminiSuggestionComplete);
router.patch('/:id/reopen', authenticate, transcriptController.reopenGeminiSuggestion);
router.get('/:id', authenticate, transcriptController.getTranscript);
router.post('/', authenticate, transcriptController.saveTranscript);

module.exports = router;
