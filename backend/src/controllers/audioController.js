// Audio Upload Controller
const path = require('path');
const fs = require('fs');
const {dbHelpers} = require('../config/database');

const AUDIO_UPLOAD_DIR = path.join(__dirname, '../../uploads/audio');

function ensureUploadDir() {
  if (!fs.existsSync(AUDIO_UPLOAD_DIR)) {
    fs.mkdirSync(AUDIO_UPLOAD_DIR, {recursive: true});
  }
}

async function uploadAudio(req, res) {
  try {
    ensureUploadDir();

    const userUid = req.userId;
    const {patientName, patientId} = req.body;

    const audioFile = req.files?.audio?.[0];
    const photoFile = req.files?.photo?.[0];

    if (!audioFile) {
      return res.status(400).json({
        success: false,
        error: 'No audio file uploaded.',
      });
    }

    const filePath = audioFile.path.replace(/\\/g, '/');
    const fileName = audioFile.originalname;
    const fileSize = audioFile.size;
    const mimeType = audioFile.mimetype;

    const photoPath = photoFile ? photoFile.path.replace(/\\/g, '/') : null;
    const photoName = photoFile ? photoFile.originalname : null;
    const photoSize = photoFile ? photoFile.size : null;
    const photoMime = photoFile ? photoFile.mimetype : null;

    const result = await dbHelpers.run(
      `INSERT INTO audio_records
        (user_uid, patient_name, patient_id, file_path, file_name, file_size, mime_type,
         photo_path, photo_name, photo_size, photo_mime)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id`,
      [
        userUid,
        patientName || null,
        patientId || null,
        filePath,
        fileName,
        fileSize,
        mimeType,
        photoPath,
        photoName,
        photoSize,
        photoMime,
      ]
    );

    res.json({
      success: true,
      message: 'Audio uploaded successfully.',
      data: {
        id: result.lastID,
        filePath,
        fileName,
        fileSize,
        mimeType,
        photoPath,
        photoName,
        photoSize,
        photoMime,
        patientName: patientName || null,
        patientId: patientId || null,
      },
    });
  } catch (error) {
    console.error('Audio upload error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

module.exports = {
  uploadAudio,
};
