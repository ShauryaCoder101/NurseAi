const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const benchmarkController = require('../controllers/benchmarkController');
const metricsController = require('../controllers/metricsController');
const {benchmarkAuth} = require('../middleware/benchmarkAuth');

const metricsUploadDir = path.join(__dirname, '../../uploads/metrics');
if (!fs.existsSync(metricsUploadDir)) {
  fs.mkdirSync(metricsUploadDir, {recursive: true});
}

const metricsStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, metricsUploadDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safeName}`);
  },
});

const metricsUpload = multer({
  storage: metricsStorage,
  limits: {fileSize: 50 * 1024 * 1024},
});

router.get('/suggestions', benchmarkAuth, benchmarkController.getBenchmarkSuggestions);
router.get('/prompt', benchmarkAuth, benchmarkController.getBenchmarkPromptText);
router.get('/scores', benchmarkAuth, benchmarkController.getBenchmarkScores);
router.get('/audio/:id', benchmarkAuth, benchmarkController.getBenchmarkAudio);
router.post('/run', benchmarkAuth, benchmarkController.runBenchmark);
router.post('/score', benchmarkAuth, benchmarkController.submitBenchmarkScore);
router.post('/backfill-audio', benchmarkAuth, benchmarkController.backfillBenchmarkAudio);

router.post('/metrics', benchmarkAuth, metricsUpload.array('files', 50), metricsController.runAudioMetrics);
router.post('/metrics-proforma', benchmarkAuth, metricsController.runProformaMetrics);

module.exports = router;
