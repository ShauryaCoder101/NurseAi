// Patient Record Controller
// Aggregates all patient data into a comprehensive JSON record
const {dbHelpers} = require('../config/database');
const path = require('path');
const {regeneratePatientHtml, generateVisitHtml} = require('../services/patientRecordHtmlService');

async function getPatientRecord(req, res) {
  try {
    const userId = req.userId;
    const {patientId} = req.params;

    if (!patientId) {
      return res.status(400).json({
        success: false,
        error: 'Patient ID is required.',
      });
    }

    // Fetch all audio records for this patient
    const audioRecords = await dbHelpers.all(
      `SELECT * FROM audio_records
       WHERE user_uid = $1 AND patient_id = $2
       ORDER BY created_at ASC`,
      [userId, patientId]
    );

    // Fetch all transcripts for this patient
    const transcripts = await dbHelpers.all(
      `SELECT * FROM transcripts
       WHERE user_uid = $1 AND patient_id = $2
       ORDER BY created_at ASC`,
      [userId, patientId]
    );

    // Fetch all AI reasoning logs for this patient
    const reasoningLogs = await dbHelpers.all(
      `SELECT * FROM ai_reasoning_log
       WHERE patient_id = $1
       ORDER BY created_at ASC`,
      [patientId]
    );

    // Fetch all follow-up logs for this patient
    const followupLogs = await dbHelpers.all(
      `SELECT * FROM followup_log
       WHERE patient_id = $1
       ORDER BY created_at ASC`,
      [patientId]
    );

    // Fetch flagged suggestions for this patient
    const flaggedSuggestions = await dbHelpers.all(
      `SELECT * FROM flagged_suggestions
       WHERE user_uid = $1 AND patient_id = $2
       ORDER BY flagged_at ASC`,
      [userId, patientId]
    );

    // Get patient name from the first available record
    const patientName =
      transcripts[0]?.patient_name ||
      audioRecords[0]?.patient_name ||
      'Unknown';

    // Group data into visits by audio_record_id
    const visitMap = new Map();

    // First, create visit entries from audio records
    audioRecords.forEach((ar, index) => {
      visitMap.set(ar.id, {
        visitNumber: index + 1,
        timestamp: ar.created_at,
        audioRecord: {
          id: ar.id,
          fileName: ar.file_name || null,
          fileSize: ar.file_size || null,
          mimeType: ar.mime_type || null,
          filePath: ar.file_path || null,
          fileUrl: ar.file_url || null,
          photoName: ar.photo_name || null,
          photoPath: ar.photo_path || null,
        },
        diagnosis: null,
        prescription: null,
        followups: [],
        aiAuditTrail: {
          diagnosisReasoning: null,
          prescriptionReasoning: null,
          followupReasoning: [],
        },
        flagged: null,
      });
    });

    // Map transcripts to their visits
    transcripts.forEach((t) => {
      const audioRecordId = t.audio_record_id;
      const visit = audioRecordId ? visitMap.get(audioRecordId) : null;

      const transcriptEntry = {
        id: t.id,
        content: t.content,
        source: t.source,
        title: t.title,
        completed: t.suggestion_completed,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      };

      if (visit) {
        if (t.source === 'gemini-diagnosis') {
          visit.diagnosis = transcriptEntry;
        } else if (t.source === 'gemini') {
          visit.prescription = transcriptEntry;
        }
      }

      // Map reasoning logs for this transcript
      const transcriptReasoningLogs = reasoningLogs.filter(
        (rl) => rl.transcript_id === t.id
      );
      transcriptReasoningLogs.forEach((rl) => {
        const reasoningEntry = {
          input: rl.input_summary,
          reasoningSteps: rl.reasoning_steps,
          output: rl.output_summary,
          modelUsed: rl.model_used,
          createdAt: rl.created_at,
        };
        if (visit) {
          if (rl.stage === 'diagnosis') {
            visit.aiAuditTrail.diagnosisReasoning = reasoningEntry;
          } else if (rl.stage === 'prescription') {
            visit.aiAuditTrail.prescriptionReasoning = reasoningEntry;
          } else if (rl.stage === 'followup') {
            visit.aiAuditTrail.followupReasoning.push(reasoningEntry);
          }
        }
      });

      // Map follow-up logs for this transcript
      const transcriptFollowups = followupLogs.filter(
        (fl) => fl.transcript_id === t.id
      );
      if (visit) {
        transcriptFollowups.forEach((fl) => {
          visit.followups.push({
            id: fl.id,
            message: fl.message,
            previousContent: fl.previous_content,
            updatedContent: fl.updated_content,
            createdAt: fl.created_at,
          });
        });
      }

      // Map flagged suggestions
      const flagged = flaggedSuggestions.find(
        (fs) => fs.transcript_id === t.id
      );
      if (visit && flagged) {
        visit.flagged = {
          reason: flagged.reason,
          flaggedAt: flagged.flagged_at,
        };
      }
    });

    // Handle transcripts without audio records (orphaned)
    const orphanedTranscripts = transcripts.filter(
      (t) => !t.audio_record_id || !visitMap.has(t.audio_record_id)
    );

    // Build final visits array from the map
    const visits = Array.from(visitMap.values());

    // Add orphaned transcripts as separate entries if any
    if (orphanedTranscripts.length > 0) {
      orphanedTranscripts.forEach((t) => {
        const orphanReasoningLogs = reasoningLogs.filter(
          (rl) => rl.transcript_id === t.id
        );
        const orphanFollowups = followupLogs.filter(
          (fl) => fl.transcript_id === t.id
        );
        const flagged = flaggedSuggestions.find(
          (fs) => fs.transcript_id === t.id
        );

        visits.push({
          visitNumber: visits.length + 1,
          timestamp: t.created_at,
          audioRecord: null,
          diagnosis:
            t.source === 'gemini-diagnosis'
              ? {
                  id: t.id,
                  content: t.content,
                  source: t.source,
                  title: t.title,
                  completed: t.suggestion_completed,
                  createdAt: t.created_at,
                  updatedAt: t.updated_at,
                }
              : null,
          prescription:
            t.source === 'gemini'
              ? {
                  id: t.id,
                  content: t.content,
                  source: t.source,
                  title: t.title,
                  completed: t.suggestion_completed,
                  createdAt: t.created_at,
                  updatedAt: t.updated_at,
                }
              : null,
          followups: orphanFollowups.map((fl) => ({
            id: fl.id,
            message: fl.message,
            previousContent: fl.previous_content,
            updatedContent: fl.updated_content,
            createdAt: fl.created_at,
          })),
          aiAuditTrail: {
            diagnosisReasoning:
              orphanReasoningLogs
                .filter((rl) => rl.stage === 'diagnosis')
                .map((rl) => ({
                  input: rl.input_summary,
                  reasoningSteps: rl.reasoning_steps,
                  output: rl.output_summary,
                  modelUsed: rl.model_used,
                  createdAt: rl.created_at,
                }))[0] || null,
            prescriptionReasoning:
              orphanReasoningLogs
                .filter((rl) => rl.stage === 'prescription')
                .map((rl) => ({
                  input: rl.input_summary,
                  reasoningSteps: rl.reasoning_steps,
                  output: rl.output_summary,
                  modelUsed: rl.model_used,
                  createdAt: rl.created_at,
                }))[0] || null,
            followupReasoning: orphanReasoningLogs
              .filter((rl) => rl.stage === 'followup')
              .map((rl) => ({
                input: rl.input_summary,
                reasoningSteps: rl.reasoning_steps,
                output: rl.output_summary,
                modelUsed: rl.model_used,
                createdAt: rl.created_at,
              })),
          },
          flagged: flagged
            ? {reason: flagged.reason, flaggedAt: flagged.flagged_at}
            : null,
        });
      });
    }

    // Sort visits by timestamp
    visits.sort(
      (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
    );
    visits.forEach((v, i) => (v.visitNumber = i + 1));

    const record = {
      patientId,
      patientName,
      generatedAt: new Date().toISOString(),
      totalVisits: visits.length,
      visits,
    };

    res.json({
      success: true,
      data: record,
    });
  } catch (error) {
    console.error('Get patient record error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

async function checkPatientExists(req, res) {
  try {
    const userId = req.userId;
    const {patientId} = req.params;

    if (!patientId) {
      return res.status(400).json({
        success: false,
        error: 'Patient ID is required.',
      });
    }

    // Check transcripts first (most likely to have the best name)
    let record = await dbHelpers.get(
      'SELECT patient_name FROM transcripts WHERE user_uid = $1 AND patient_id = $2 AND patient_name IS NOT NULL LIMIT 1',
      [userId, patientId]
    );

    // Filter fallback to audio_records if no transcript has the name
    if (!record) {
      record = await dbHelpers.get(
        'SELECT patient_name FROM audio_records WHERE user_uid = $1 AND patient_id = $2 AND patient_name IS NOT NULL LIMIT 1',
        [userId, patientId]
      );
    }

    if (record) {
      return res.json({
        success: true,
        data: {
          exists: true,
          patientName: record.patient_name,
        },
      });
    }

    return res.json({
      success: true,
      data: {
        exists: false,
      },
    });
  } catch (error) {
    console.error('Check patient exists error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

async function getPatientRecordHtml(req, res) {
  try {
    const {patientId} = req.params;

    if (!patientId) {
      return res.status(400).send('Patient ID is required.');
    }

    const htmlPath = path.join(__dirname, '../../patient_records', `${patientId}.html`);

    if (fs.existsSync(htmlPath)) {
      res.setHeader('Content-Type', 'text/html');
      return res.sendFile(htmlPath);
    } else {
      res.status(404).send('Patient HTML record not found or not yet generated.');
    }
  } catch (error) {
    console.error('Get patient HTML record error:', error);
    res.status(500).send('Internal server error.');
  }
}

async function getVisitRecordHtml(req, res) {
  try {
    const {patientId, transcriptId} = req.params;

    if (!patientId || !transcriptId) {
      return res.status(400).send('Patient ID and Transcript ID are required.');
    }

    // Reuse the getPatientRecord logic manually internal to build the record object, 
    // but just for that patient, then pass it to generateVisitHtml.
    
    const audioRecords = await dbHelpers.all(
      `SELECT * FROM audio_records WHERE patient_id = $1 ORDER BY created_at ASC`,
      [patientId]
    );

    const transcripts = await dbHelpers.all(
      `SELECT * FROM transcripts WHERE patient_id = $1 ORDER BY created_at ASC`,
      [patientId]
    );

    const reasoningLogs = await dbHelpers.all(
      `SELECT * FROM ai_reasoning_log WHERE patient_id = $1 ORDER BY created_at ASC`,
      [patientId]
    );

    const followupLogs = await dbHelpers.all(
      `SELECT * FROM followup_log WHERE patient_id = $1 ORDER BY created_at ASC`,
      [patientId]
    );

    const flaggedSuggestions = await dbHelpers.all(
      `SELECT * FROM flagged_suggestions WHERE patient_id = $1 ORDER BY flagged_at ASC`,
      [patientId]
    );

    const patientName = transcripts[0]?.patient_name || audioRecords[0]?.patient_name || 'Unknown';

    const visitMap = new Map();
    audioRecords.forEach((ar, index) => {
      visitMap.set(ar.id, {
        visitNumber: index + 1,
        timestamp: ar.created_at,
        audioRecord: { id: ar.id, fileName: ar.file_name, fileSize: ar.file_size, mimeType: ar.mime_type, fileUrl: ar.file_url },
        diagnosis: null, prescription: null, followups: [],
        aiAuditTrail: { diagnosisReasoning: null, prescriptionReasoning: null, followupReasoning: [] },
        flagged: null,
      });
    });

    transcripts.forEach((t) => {
      const audioRecordId = t.audio_record_id;
      const visit = audioRecordId ? visitMap.get(audioRecordId) : null;
      if (!visit) return;

      const entry = { id: t.id, content: t.content, createdAt: t.created_at };
      if (t.source === 'gemini-diagnosis') visit.diagnosis = entry;
      else if (t.source === 'gemini') visit.prescription = entry;

      const tReasoningLogs = reasoningLogs.filter((rl) => rl.transcript_id === t.id);
      tReasoningLogs.forEach((rl) => {
        const re = { input: rl.input_summary, reasoningSteps: rl.reasoning_steps, output: rl.output_summary, createdAt: rl.created_at };
        if (rl.stage === 'diagnosis') visit.aiAuditTrail.diagnosisReasoning = re;
        else if (rl.stage === 'prescription') visit.aiAuditTrail.prescriptionReasoning = re;
        else if (rl.stage === 'followup') visit.aiAuditTrail.followupReasoning.push(re);
      });

      const tFollowups = followupLogs.filter((fl) => fl.transcript_id === t.id);
      tFollowups.forEach((fl) => {
        visit.followups.push({ id: fl.id, message: fl.message, updatedContent: fl.updated_content, createdAt: fl.created_at });
      });

      const flagged = flaggedSuggestions.find((fs) => fs.transcript_id === t.id);
      if (flagged) visit.flagged = { reason: flagged.reason, flaggedAt: flagged.flagged_at };
    });

    const visits = Array.from(visitMap.values());
    visits.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    visits.forEach((v, i) => (v.visitNumber = i + 1));

    const record = { patientId, patientName, generatedAt: new Date().toISOString(), visits };

    const html = generateVisitHtml(record, transcriptId);
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.send(html);

  } catch (error) {
    console.error('Get visit HTML record error:', error);
    res.status(500).send('Internal server error.');
  }
}

module.exports = {
  getPatientRecord,
  checkPatientExists,
  getPatientRecordHtml,
  getVisitRecordHtml,
};
