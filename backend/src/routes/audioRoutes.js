// Audio Routes
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const audioController = require('../controllers/audioController');
const {authenticate} = require('../middleware/auth');

const uploadDir = path.join(__dirname, '../../uploads/audio');

function ensureUploadDir() {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, {recursive: true});
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    ensureUploadDir();
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${timestamp}_${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: {fileSize: 50 * 1024 * 1024}, // 50MB total per file
});

router.post(
  '/upload',
  authenticate,
  upload.fields([
    {name: 'audio', maxCount: 1},
    {name: 'photo', maxCount: 1},
  ]),
  audioController.uploadAudio
);

module.exports = router;
