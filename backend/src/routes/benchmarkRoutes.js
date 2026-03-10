const express = require('express');
const router = express.Router();
const benchmarkController = require('../controllers/benchmarkController');
const {benchmarkAuth} = require('../middleware/benchmarkAuth');

router.get('/suggestions', benchmarkAuth, benchmarkController.getBenchmarkSuggestions);
router.get('/prompt', benchmarkAuth, benchmarkController.getBenchmarkPromptText);
router.get('/scores', benchmarkAuth, benchmarkController.getBenchmarkScores);
router.get('/audio/:id', benchmarkAuth, benchmarkController.getBenchmarkAudio);
router.post('/run', benchmarkAuth, benchmarkController.runBenchmark);
router.post('/score', benchmarkAuth, benchmarkController.submitBenchmarkScore);
router.post('/backfill-audio', benchmarkAuth, benchmarkController.backfillBenchmarkAudio);

module.exports = router;
