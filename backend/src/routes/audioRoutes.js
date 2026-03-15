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
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'audio') {
      const mime = file.mimetype || '';
      const name = (file.originalname || '').toLowerCase();
      const isAudioMime = mime.startsWith('audio/');
      const isOctetStream = mime === 'application/octet-stream';
      const hasAudioExt = /\.(m4a|mp4|mp3|wav|aac|3gp|3gpp|caf|ogg|webm)$/.test(name);
      if (isAudioMime || (isOctetStream && hasAudioExt)) {
        return cb(null, true);
      }
      console.warn(`Rejected audio upload: mime=${mime}, name=${name}`);
      return cb(new Error('Invalid audio file type'), false);
    }
    if (file.fieldname === 'photo') {
      if (file.mimetype && file.mimetype.startsWith('image/')) {
        return cb(null, true);
      }
      return cb(new Error('Invalid photo file type'), false);
    }
    if (file.fieldname === 'audio2') {
      const mime = file.mimetype || '';
      const name = (file.originalname || '').toLowerCase();
      const isAudioMime = mime.startsWith('audio/');
      const isOctetStream = mime === 'application/octet-stream';
      const hasAudioExt = /\.(m4a|mp4|mp3|wav|aac|3gp|3gpp|caf|ogg|webm)$/.test(name);
      if (isAudioMime || (isOctetStream && hasAudioExt)) {
        return cb(null, true);
      }
      return cb(new Error('Invalid audio2 file type'), false);
    }
    return cb(new Error('Unexpected file field'), false);
  },
  limits: {fileSize: 50 * 1024 * 1024},
});

router.post(
  '/upload',
  authenticate,
  upload.fields([
    {name: 'audio', maxCount: 1},
    {name: 'photo', maxCount: 1},
    {name: 'audio2', maxCount: 1},
  ]),
  audioController.uploadAudio
);

const extractStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tmpDir = path.join(__dirname, '../../uploads/tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, {recursive: true});
    }
    cb(null, tmpDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `extract_${Date.now()}_${safeName}`);
  },
});

const extractUpload = multer({
  storage: extractStorage,
  fileFilter: (req, file, cb) => {
    const mime = file.mimetype || '';
    const name = (file.originalname || '').toLowerCase();
    const isAudioMime = mime.startsWith('audio/');
    const isOctetStream = mime === 'application/octet-stream';
    const hasAudioExt = /\.(m4a|mp4|mp3|wav|aac|3gp|3gpp|caf|ogg|webm)$/.test(name);
    if (isAudioMime || (isOctetStream && hasAudioExt)) {
      return cb(null, true);
    }
    return cb(new Error('Invalid audio file type'), false);
  },
  limits: {fileSize: 50 * 1024 * 1024},
});

router.post(
  '/extract-proforma',
  authenticate,
  extractUpload.single('audio'),
  audioController.extractProforma
);

router.post(
  '/:id/retry-gemini',
  authenticate,
  audioController.retryGeminiForAudioRecord
);

const answerStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tmpDir = path.join(__dirname, '../../uploads/tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, {recursive: true});
    }
    cb(null, tmpDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `answer_${Date.now()}_${safeName}`);
  },
});

const answerUpload = multer({
  storage: answerStorage,
  fileFilter: (req, file, cb) => {
    const mime = file.mimetype || '';
    const name = (file.originalname || '').toLowerCase();
    const isAudioMime = mime.startsWith('audio/');
    const isOctetStream = mime === 'application/octet-stream';
    const hasAudioExt = /\.(m4a|mp4|mp3|wav|aac|3gp|3gpp|caf|ogg|webm)$/.test(name);
    if (isAudioMime || (isOctetStream && hasAudioExt)) {
      return cb(null, true);
    }
    return cb(new Error('Invalid audio file type'), false);
  },
  limits: {fileSize: 50 * 1024 * 1024},
});

router.post(
  '/:id/prescribe',
  authenticate,
  answerUpload.single('answerAudio'),
  audioController.finalizePrescription
);

module.exports = router;
