// Audio Upload Controller
const path = require('path');
const fs = require('fs');
const {dbHelpers} = require('../config/database');
const {generateGeminiSuggestion} = require('../services/geminiService');

const AUDIO_UPLOAD_DIR = path.join(__dirname, '../../uploads/audio');

function ensureUploadDir() {
  if (!fs.existsSync(AUDIO_UPLOAD_DIR)) {
    fs.mkdirSync(AUDIO_UPLOAD_DIR, {recursive: true});
  }
}

function sanitizeSegment(value) {
  if (!value) return 'unknown';
  return String(value)
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function uploadAudio(req, res) {
  try {
    ensureUploadDir();

    const userUid = req.userId;
    const userEmail = req.user?.email || 'unknown';
    const {patientName, patientId} = req.body;

    const audioFile = req.files?.audio?.[0];
    const photoFile = req.files?.photo?.[0];

    if (!audioFile) {
      return res.status(400).json({
        success: false,
        error: 'No audio file uploaded.',
      });
    }

    let filePath = audioFile.path.replace(/\\/g, '/');
    let fileName = audioFile.originalname;
    const fileSize = audioFile.size;
    const mimeType = audioFile.mimetype;

    const patientKey = patientId || patientName || 'unknown';
    const serialResult = await dbHelpers.get(
      `SELECT COUNT(*)::int AS count
       FROM audio_records
       WHERE user_uid = $1 AND COALESCE(patient_id, patient_name, 'unknown') = $2`,
      [userUid, patientKey]
    );
    const nextSerial = (serialResult?.count || 0) + 1;
    const emailSegment = sanitizeSegment(userEmail);
    const patientSegment = sanitizeSegment(patientName || patientId || 'unknown');
    const serialSegment = String(nextSerial);
    const originalSegment = sanitizeSegment(audioFile.originalname);
    const renamedFile = `${emailSegment}_${patientSegment}_${serialSegment}_${originalSegment}`;
    const renamedPath = path.join(AUDIO_UPLOAD_DIR, renamedFile).replace(/\\/g, '/');

    try {
      fs.renameSync(audioFile.path, renamedPath);
      filePath = renamedPath;
      fileName = renamedFile;
    } catch (renameError) {
      console.error('Audio rename failed, keeping original name:', renameError);
    }

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

    let geminiText = null;
    let transcriptId = null;
    let geminiErrorMessage = null;
    try {
      if (!patientId) {
        geminiErrorMessage = 'Patient ID is required for Gemini suggestions.';
      } else {
        geminiText = await generateGeminiSuggestion({
          audioPath: filePath,
          mimeType,
          patientId,
        });
        if (!geminiText || !geminiText.trim()) {
          geminiText = null;
          geminiErrorMessage = 'Gemini returned an empty response.';
        }
      }

      if (geminiText) {
        const transcriptResult = await dbHelpers.run(
          `INSERT INTO transcripts
            (id, user_uid, title, content, patient_name, patient_id, source, audio_record_id, suggestion_completed, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, FALSE, NOW(), NOW())
           RETURNING id`,
          [
            userUid,
            patientId ? `Clinical Decision Support - ${patientId}` : 'Clinical Decision Support',
            geminiText,
            patientName || null,
            patientId || null,
            'gemini',
            result.lastID,
          ]
        );
        transcriptId = transcriptResult.lastID;
      }
    } catch (geminiError) {
      console.error('Gemini processing error:', geminiError);
      geminiErrorMessage = geminiError?.message || 'Gemini processing failed.';
    }

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
        geminiGenerated: Boolean(geminiText),
        geminiError: geminiErrorMessage,
        transcriptId,
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
