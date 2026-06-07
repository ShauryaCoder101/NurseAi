// Audio Upload Controller
const path = require('path');
const fs = require('fs');
const {dbHelpers} = require('../config/database');
const {generateGeminiSuggestion, generateDiagnosisFromAudio, generatePrescription, generateExtractedProforma} = require('../services/geminiService');
const {uploadAudioFile, isStorageConfigured} = require('../services/supabaseStorage');
const {regeneratePatientHtml} = require('../services/patientRecordHtmlService');
const {insertGeminiAuditLog} = require('../services/geminiAuditLog');

const AUDIO_UPLOAD_DIR = path.join(__dirname, '../../uploads/audio');

// Exported for reuse by other controllers
async function fetchPatientHistory(patientId) {
  if (!patientId) return '';
  const rows = await dbHelpers.all(
    `SELECT content, source, created_at FROM transcripts
     WHERE patient_id = $1 AND source IN ('gemini', 'gemini-diagnosis')
     ORDER BY created_at ASC`,
    [patientId]
  );
  if (!rows || rows.length === 0) return '';
  return rows.map((r) => {
    // Show exact timestamp as requested
    const date = r.created_at ? new Date(r.created_at).toLocaleString() : 'unknown timestamp';
    const type = r.source === 'gemini-diagnosis' ? 'diagnosis' : 'prescription';
    return `Visit (${date}, ${type}):\n${r.content}`;
  }).join('\n\n---\n\n');
}

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
  let audio2File;
  try {
    ensureUploadDir();

    const userUid = req.userId;
    const userEmail = req.user?.email || 'unknown';
    const {patientName, patientId} = req.body;

    const audioFile = req.files?.audio?.[0];
    const photoFile = req.files?.photo?.[0];
    audio2File = req.files?.audio2?.[0];

    if (!audioFile) {
      return res.status(400).json({
        success: false,
        error: 'No audio file uploaded.',
      });
    }

    console.log(`Audio received: name=${audioFile.originalname}, size=${audioFile.size}, mime=${audioFile.mimetype}`);

    if (!audioFile.size || audioFile.size === 0) {
      return res.status(400).json({
        success: false,
        error: 'Audio file is empty (0 bytes). Recording may have failed on the device.',
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

    if (patientId) {
      dbHelpers.run(
        `INSERT INTO patients (patient_id, patient_name, user_uid)
         VALUES ($1, $2, $3)
         ON CONFLICT (patient_id, user_uid) DO UPDATE SET patient_name = EXCLUDED.patient_name`,
        [patientId, patientName || null, userUid]
      ).catch(err => console.error('Failed to upsert patient:', err));
    }

    let fileUrl = null;
    let storagePath = null;
    if (isStorageConfigured()) {
      // Fire-and-forget: upload runs in background while Gemini call proceeds immediately
      const recordId = result.lastID;
      uploadAudioFile({ filePath, fileName, recordId, mimeType })
        .then(uploadResult => {
          if (uploadResult) {
            return dbHelpers.run(
              'UPDATE audio_records SET file_url = $1, storage_path = $2 WHERE id = $3',
              [uploadResult.publicUrl, uploadResult.storagePath, recordId]
            ).then(() => {
              fs.unlink(filePath, (err) => {
                if (err) console.error('Failed to delete local audio after Supabase upload:', err);
              });
            });
          }
        })
        .catch(uploadError => console.error('Supabase audio upload failed:', uploadError));
    } else {
      fileUrl = `/uploads/audio/${encodeURIComponent(fileName)}`;
      await dbHelpers.run(
        'UPDATE audio_records SET file_url = $1 WHERE id = $2',
        [fileUrl, result.lastID]
      );
    }

    let diagnosisText = null;
    let transcriptId = null;
    let geminiErrorMessage = null;
    let geminiErrorCode = null;
    let geminiRetryAfterSeconds = null;
    try {
      if (!patientId) {
        geminiErrorMessage = 'Patient ID is required for Gemini suggestions.';
      } else {
        const audioPaths = [filePath];
        const audioMimeTypes = [mimeType];
        if (audio2File) {
          audioPaths.push(audio2File.path.replace(/\\/g, '/'));
          audioMimeTypes.push(audio2File.mimetype || 'audio/mp4');
        }
        const diagnosisResult = await generateDiagnosisFromAudio({
          audioPaths,
          mimeTypes: audioMimeTypes,
          patientId,
        });
        diagnosisText = diagnosisResult.text || diagnosisResult;
        const diagnosisReasoning = diagnosisResult.reasoning || null;
        const diagnosisModel = diagnosisResult.modelUsed || null;
        if (!diagnosisText || !diagnosisText.trim()) {
          diagnosisText = null;
          geminiErrorMessage = 'Gemini returned an empty response.';
        }

        // Audit log — fire and forget
        insertGeminiAuditLog({
          stage: 'diagnosis',
          userUid,
          patientId: patientId || null,
          audioRecordId: result.lastID,
          modelUsed: diagnosisModel,
          finalOutput: diagnosisText,
          reasoningText: diagnosisReasoning ? JSON.stringify(diagnosisReasoning) : null,
          errorMessage: diagnosisText ? null : geminiErrorMessage,
          ...(diagnosisResult._audit || {}),
        }).catch(() => {});

        if (diagnosisText) {
          const transcriptResult = await dbHelpers.run(
            `INSERT INTO transcripts
              (id, user_uid, title, content, patient_name, patient_id, source, audio_record_id, suggestion_completed, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, FALSE, NOW(), NOW())
             RETURNING id`,
            [
              userUid,
              patientId ? `2Diagnosis - ${patientId}` : '2Diagnosis',
              diagnosisText,
              patientName || null,
              patientId || null,
              'gemini-diagnosis',
              result.lastID,
            ]
          );
          transcriptId = transcriptResult.lastID;

        }
      }
    } catch (geminiError) {
      console.error('Gemini processing error:', geminiError);
      geminiErrorMessage = geminiError?.message || 'Gemini processing failed.';
      if (geminiError?.code === 'RATE_LIMIT') {
        geminiErrorCode = 'RATE_LIMIT';
        const retryAfterMs = Number(geminiError?.retryAfterMs || 0);
        const fallbackSeconds = 60;
        const derivedSeconds = Math.ceil(retryAfterMs / 1000);
        geminiRetryAfterSeconds = Math.max(fallbackSeconds, derivedSeconds || fallbackSeconds);
        geminiErrorMessage =
          'Too many concurrent users. Please try again in 60 seconds.';
      }
    }

    // Regenerate patient HTML file after processing
    if (patientId) {
      regeneratePatientHtml(userUid, patientId).catch((e) =>
        console.error('HTML regen error (upload):', e)
      );
    }

    res.json({
      success: true,
      message: 'Audio uploaded successfully.',
      data: {
        id: result.lastID,
        filePath,
        fileUrl,
        storagePath,
        fileName,
        fileSize,
        mimeType,
        photoPath,
        photoName,
        photoSize,
        photoMime,
        patientName: patientName || null,
        patientId: patientId || null,
        geminiGenerated: Boolean(diagnosisText),
        diagnosisText: diagnosisText || null,
        geminiError: geminiErrorMessage,
        geminiErrorCode,
        geminiRetryAfterSeconds,
        transcriptId,
      },
    });

    if (audio2File) {
      try { fs.unlinkSync(audio2File.path); } catch (_) {}
    }
  } catch (error) {
    console.error('Audio upload error:', error);
    if (audio2File) {
      try { fs.unlinkSync(audio2File.path); } catch (_) {}
    }
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

async function retryGeminiForAudioRecord(req, res) {
  try {
    const userUid = req.userId;
    const {id} = req.params;

    const audioRecord = await dbHelpers.get(
      'SELECT * FROM audio_records WHERE id = $1 AND user_uid = $2',
      [id, userUid]
    );

    if (!audioRecord) {
      return res.status(404).json({
        success: false,
        error: 'Audio record not found.',
      });
    }

    const existingTranscript = await dbHelpers.get(
      `SELECT id FROM transcripts
       WHERE audio_record_id = $1 AND user_uid = $2 AND source = 'gemini'
       ORDER BY created_at DESC LIMIT 1`,
      [id, userUid]
    );

    if (existingTranscript) {
      return res.json({
        success: true,
        data: {
          audioRecordId: id,
          transcriptId: existingTranscript.id,
          geminiGenerated: true,
          alreadyGenerated: true,
        },
      });
    }

    if (!audioRecord.patient_id) {
      return res.status(400).json({
        success: false,
        error: 'Patient ID is required for Gemini suggestions.',
      });
    }

    let geminiText = null;
    let transcriptId = null;
    let geminiErrorMessage = null;
    let geminiErrorCode = null;
    let geminiRetryAfterSeconds = null;

    try {
      geminiText = await generateGeminiSuggestion({
        audioPath: audioRecord.file_path,
        mimeType: audioRecord.mime_type,
        patientId: audioRecord.patient_id,
      });
      if (!geminiText || !geminiText.trim()) {
        geminiText = null;
        geminiErrorMessage = 'Gemini returned an empty response.';
      }

      if (geminiText) {
        const transcriptResult = await dbHelpers.run(
          `INSERT INTO transcripts
            (id, user_uid, title, content, patient_name, patient_id, source, audio_record_id, suggestion_completed, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, FALSE, NOW(), NOW())
           RETURNING id`,
          [
            userUid,
            audioRecord.patient_id
              ? `Clinical Decision Support - ${audioRecord.patient_id}`
              : 'Clinical Decision Support',
            geminiText,
            audioRecord.patient_name || null,
            audioRecord.patient_id || null,
            'gemini',
            audioRecord.id,
          ]
        );
        transcriptId = transcriptResult.lastID;
      }
    } catch (geminiError) {
      console.error('Gemini retry error:', geminiError);
      geminiErrorMessage = geminiError?.message || 'Gemini processing failed.';
      if (geminiError?.code === 'RATE_LIMIT') {
        geminiErrorCode = 'RATE_LIMIT';
        const retryAfterMs = Number(geminiError?.retryAfterMs || 0);
        const fallbackSeconds = 60;
        const derivedSeconds = Math.ceil(retryAfterMs / 1000);
        geminiRetryAfterSeconds = Math.max(fallbackSeconds, derivedSeconds || fallbackSeconds);
        geminiErrorMessage =
          'Too many concurrent users. Please try again in 60 seconds.';
      }
    }

    return res.json({
      success: true,
      data: {
        audioRecordId: audioRecord.id,
        transcriptId,
        geminiGenerated: Boolean(geminiText),
        geminiError: geminiErrorMessage,
        geminiErrorCode,
        geminiRetryAfterSeconds,
      },
    });
  } catch (error) {
    console.error('Retry Gemini error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

async function finalizePrescription(req, res) {
  let answerAudioPath = null;
  try {
    const userUid = req.userId;
    const {id} = req.params;

    const answerFile = req.file;
    if (!answerFile) {
      return res.status(400).json({
        success: false,
        error: 'Answer audio file is required.',
      });
    }

    answerAudioPath = answerFile.path.replace(/\\/g, '/');
    const answerMimeType = answerFile.mimetype || 'audio/mp4';

    const audioRecord = await dbHelpers.get(
      'SELECT * FROM audio_records WHERE id = $1 AND user_uid = $2',
      [id, userUid]
    );

    if (!audioRecord) {
      return res.status(404).json({
        success: false,
        error: 'Audio record not found.',
      });
    }

    const diagnosisTranscript = await dbHelpers.get(
      `SELECT * FROM transcripts
       WHERE audio_record_id = $1 AND user_uid = $2 AND source = 'gemini-diagnosis'
       ORDER BY created_at DESC LIMIT 1`,
      [id, userUid]
    );

    if (!diagnosisTranscript) {
      return res.status(404).json({
        success: false,
        error: 'No diagnosis found for this recording. Please re-upload.',
      });
    }

    const prescriptionResult = await generatePrescription({
      diagnosisText: diagnosisTranscript.content,
      answerAudioPath,
      answerMimeType,
      patientId: audioRecord.patient_id,
    });

    const prescriptionText = typeof prescriptionResult === 'string'
      ? prescriptionResult
      : (prescriptionResult?.text ?? '');
    const prescriptionReasoning = prescriptionResult?.reasoning || null;
    const prescriptionModel = prescriptionResult?.modelUsed || null;

    if (!prescriptionText || !prescriptionText.trim()) {
      return res.status(502).json({
        success: false,
        error: 'Gemini returned an empty prescription response.',
      });
    }

    const transcriptResult = await dbHelpers.run(
      `INSERT INTO transcripts
        (id, user_uid, title, content, patient_name, patient_id, source, audio_record_id, suggestion_completed, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, FALSE, NOW(), NOW())
       RETURNING id`,
      [
        userUid,
        audioRecord.patient_id
          ? `Clinical Decision Support - ${audioRecord.patient_id}`
          : 'Clinical Decision Support',
        prescriptionText,
        audioRecord.patient_name || null,
        audioRecord.patient_id || null,
        'gemini',
        audioRecord.id,
      ]
    );

    // Gemini audit log — fire and forget
    insertGeminiAuditLog({
      stage: 'prescription',
      userUid,
      patientId: audioRecord.patient_id || null,
      audioRecordId: audioRecord.id,
      transcriptId: transcriptResult.lastID,
      modelUsed: prescriptionModel,
      finalOutput: prescriptionText,
      reasoningText: prescriptionReasoning ? JSON.stringify(prescriptionReasoning) : null,
      ...(prescriptionResult._audit || {}),
    }).catch(() => {});

    // Regenerate patient HTML file after prescription
    if (audioRecord.patient_id) {
      regeneratePatientHtml(userUid, audioRecord.patient_id).catch((e) =>
        console.error('HTML regen error (prescribe):', e)
      );
    }

    res.json({
      success: true,
      data: {
        transcriptId: transcriptResult.lastID,
        prescriptionText,
        audioRecordId: audioRecord.id,
        patientName: audioRecord.patient_name,
        patientId: audioRecord.patient_id,
      },
    });
  } catch (error) {
    console.error('Finalize prescription error:', error);
    if (error?.code === 'RATE_LIMIT') {
      return res.status(429).json({
        success: false,
        error: 'Too many concurrent users. Please try again in 60 seconds.',
      });
    }
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  } finally {
    if (answerAudioPath) {
      try { fs.unlinkSync(answerAudioPath); } catch (_) {}
    }
  }
}

async function extractProforma(req, res) {
  let tempAudioPath = null;
  try {
    const audioFile = req.file;
    if (!audioFile) {
      return res.status(400).json({
        success: false,
        error: 'No audio file uploaded.',
      });
    }

    tempAudioPath = audioFile.path.replace(/\\/g, '/');
    const mimeType = audioFile.mimetype || 'audio/mp4';
    const patientId = req.body?.patientId || 'Unknown';

    console.log(`Extract proforma: size=${audioFile.size}, mime=${mimeType}, patient=${patientId}`);

    const proformaResult = await generateExtractedProforma({
      audioPath: tempAudioPath,
      mimeType,
      patientId,
    });

    const proformaText = typeof proformaResult === 'string' ? proformaResult : (proformaResult?.text ?? '');

    if (!proformaText || !proformaText.trim()) {
      return res.status(502).json({
        success: false,
        error: 'Gemini returned an empty proforma response.',
      });
    }

    // Gemini audit log for both extraction and generation steps — fire and forget
    if (proformaResult._auditExtraction) {
      insertGeminiAuditLog({
        stage: 'proforma:extraction',
        patientId,
        modelUsed: proformaResult.modelUsed || null,
        ...proformaResult._auditExtraction,
      }).catch(() => {});
    }
    if (proformaResult._auditProforma) {
      insertGeminiAuditLog({
        stage: 'proforma:generation',
        patientId,
        modelUsed: proformaResult.modelUsed || null,
        finalOutput: proformaText,
        ...proformaResult._auditProforma,
      }).catch(() => {});
    }

    res.json({
      success: true,
      data: {proformaText: proformaText.trim()},
    });
  } catch (error) {
    console.error('Extract proforma error:', error);
    if (error?.code === 'RATE_LIMIT') {
      return res.status(429).json({
        success: false,
        error: 'Too many concurrent users. Please try again in 60 seconds.',
      });
    }
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  } finally {
    if (tempAudioPath) {
      try { fs.unlinkSync(tempAudioPath); } catch (_) {}
    }
  }
}

module.exports = {
  uploadAudio,
  retryGeminiForAudioRecord,
  finalizePrescription,
  extractProforma,
  fetchPatientHistory,
};
