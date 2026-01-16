// Transcript Controller
const {v4: uuidv4} = require('uuid');
const {dbHelpers} = require('../config/database');
const {generateGeminiFollowup} = require('../services/geminiService');

// Get all transcripts
async function getTranscripts(req, res) {
  try {
    const userId = req.userId;
    const {patientName, patientId} = req.query;

    // Build query with optional filters
    let query = 'SELECT * FROM transcripts WHERE user_uid = $1';
    const params = [userId];
    let paramIndex = 2;

    if (patientName) {
      query += ` AND LOWER(patient_name) = LOWER($${paramIndex})`;
      params.push(patientName.trim());
      paramIndex++;
    }

    if (patientId) {
      query += ` AND patient_id = $${paramIndex}`;
      params.push(patientId.trim());
      paramIndex++;
    }

    query += ' ORDER BY created_at DESC';

    const transcripts = await dbHelpers.all(query, params);

    // Format transcripts
    const formattedTranscripts = transcripts.map((transcript) => ({
      id: transcript.id,
      title: transcript.title || `${transcript.patient_name || 'Untitled'} - ${new Date(transcript.created_at).toLocaleDateString()}`,
      date: transcript.created_at.split(' ')[0], // Get date part only
      preview: transcript.content.substring(0, 100) + (transcript.content.length > 100 ? '...' : ''),
      patientName: transcript.patient_name,
      patientId: transcript.patient_id,
      content: transcript.content,
      source: transcript.source || 'manual',
      audioRecordId: transcript.audio_record_id || null,
      suggestionCompleted: transcript.suggestion_completed || false,
    }));

    res.json({
      success: true,
      data: formattedTranscripts,
    });
  } catch (error) {
    console.error('Get transcripts error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

// Get single transcript
async function getTranscript(req, res) {
  try {
    const {id} = req.params;
    const userId = req.userId;

    const transcript = await dbHelpers.get(
      'SELECT * FROM transcripts WHERE id = $1 AND user_uid = $2',
      [id, userId]
    );

    if (!transcript) {
      return res.status(404).json({
        success: false,
        error: 'Transcript not found.',
      });
    }

    res.json({
      success: true,
      data: {
        id: transcript.id,
        title: transcript.title,
        content: transcript.content,
        patientName: transcript.patient_name,
        patientId: transcript.patient_id,
        source: transcript.source || 'manual',
        audioRecordId: transcript.audio_record_id || null,
        suggestionCompleted: transcript.suggestion_completed || false,
        createdAt: transcript.created_at,
        updatedAt: transcript.updated_at,
      },
    });
  } catch (error) {
    console.error('Get transcript error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

// Save transcript
async function saveTranscript(req, res) {
  try {
    const userId = req.userId;
    const {content, title, patientName, patientId, audioRecordId} = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Transcript content is required.',
      });
    }

    const transcriptId = uuidv4();
    const now = new Date().toISOString();

    await dbHelpers.run(
      'INSERT INTO transcripts (id, user_uid, title, content, patient_name, patient_id, source, audio_record_id, suggestion_completed, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, $9, $10)',
      [
        transcriptId,
        userId,
        title || null,
        content,
        patientName || null,
        patientId || null,
        'manual',
        audioRecordId || null,
        now,
        now,
      ]
    );

    res.json({
      success: true,
      message: 'Transcript saved successfully.',
      data: {
        id: transcriptId,
        title,
        content,
        patientName,
        patientId,
        source: 'manual',
        audioRecordId: audioRecordId || null,
        suggestionCompleted: false,
      },
    });
  } catch (error) {
    console.error('Save transcript error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

// Get latest Gemini suggestion
async function getLatestGeminiSuggestion(req, res) {
  try {
    const userId = req.userId;
    const {patientName, patientId} = req.query;

    let query =
      "SELECT * FROM transcripts WHERE user_uid = $1 AND source = 'gemini'";
    const params = [userId];
    let paramIndex = 2;

    if (patientName) {
      query += ` AND LOWER(patient_name) = LOWER($${paramIndex})`;
      params.push(patientName.trim());
      paramIndex++;
    }

    if (patientId) {
      query += ` AND patient_id = $${paramIndex}`;
      params.push(patientId.trim());
      paramIndex++;
    }

    query += ' ORDER BY created_at DESC LIMIT 1';

    const transcript = await dbHelpers.get(query, params);

    if (!transcript) {
      return res.json({success: true, data: null});
    }

    res.json({
      success: true,
      data: {
        id: transcript.id,
        title: transcript.title,
        content: transcript.content,
        patientName: transcript.patient_name,
        patientId: transcript.patient_id,
        source: transcript.source || 'gemini',
        audioRecordId: transcript.audio_record_id || null,
        createdAt: transcript.created_at,
      },
    });
  } catch (error) {
    console.error('Get latest Gemini suggestion error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

// Get all Gemini suggestions (optionally include completed)
async function getGeminiSuggestions(req, res) {
  try {
    const userId = req.userId;
    const {includeCompleted = 'false'} = req.query;

    let query =
      "SELECT * FROM transcripts WHERE user_uid = $1 AND source = 'gemini'";
    const params = [userId];

    if (includeCompleted !== 'true') {
      query += ' AND suggestion_completed = FALSE';
    }

    query += ' ORDER BY created_at DESC';

    const transcripts = await dbHelpers.all(query, params);
    const formatted = transcripts.map((transcript) => ({
      id: transcript.id,
      title: transcript.title,
      content: transcript.content,
      patientName: transcript.patient_name,
      patientId: transcript.patient_id,
      source: transcript.source || 'gemini',
      audioRecordId: transcript.audio_record_id || null,
      suggestionCompleted: transcript.suggestion_completed || false,
      createdAt: transcript.created_at,
    }));

    res.json({success: true, data: formatted});
  } catch (error) {
    console.error('Get Gemini suggestions error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

// Mark Gemini suggestion as completed
async function markGeminiSuggestionComplete(req, res) {
  try {
    const userId = req.userId;
    const {id} = req.params;

    await dbHelpers.run(
      `UPDATE transcripts
       SET suggestion_completed = TRUE, updated_at = NOW()
       WHERE id = $1 AND user_uid = $2 AND source = 'gemini'`,
      [id, userId]
    );

    res.json({success: true});
  } catch (error) {
    console.error('Mark Gemini suggestion complete error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

function replaceMissingSection(content, provided) {
  if (!content) return content;
  const headerRegex = /8\.\s*Missing Data[\s\S]*?(?=\n\d+\.\s|\nTone:|$)/i;
  const lines = [
    '8. Missing Data',
    '',
    ...provided,
  ];
  const replacement = `${lines.join('\n')}\n`;

  if (headerRegex.test(content)) {
    return content.replace(headerRegex, replacement);
  }

  return `${content.trim()}\n\n${replacement}`;
}

async function updateGeminiMissingData(req, res) {
  try {
    const userId = req.userId;
    const {id} = req.params;
    const {missingData = {}} = req.body;

    const transcript = await dbHelpers.get(
      "SELECT * FROM transcripts WHERE id = $1 AND user_uid = $2 AND source = 'gemini'",
      [id, userId]
    );

    if (!transcript) {
      return res.status(404).json({
        success: false,
        error: 'Gemini suggestion not found.',
      });
    }

    const orderedFields = [
      ['age', 'Age'],
      ['gender', 'Gender'],
      ['occupation', 'Occupation'],
      ['spo2', 'SpO2'],
      ['bp', 'BP'],
      ['hr', 'HR'],
      ['rr', 'RR'],
      ['weight', 'Weight'],
      ['height', 'Height'],
      ['bmi', 'BMI'],
    ];

    const providedLines = orderedFields
      .map(([key, label]) => {
        const value = missingData[key];
        if (!value || String(value).trim().length === 0) return null;
        return `${label}: ${String(value).trim()}`;
      })
      .filter(Boolean);

    if (providedLines.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No missing data values provided.',
      });
    }

    const updatedContent = replaceMissingSection(transcript.content, providedLines);

    await dbHelpers.run(
      'UPDATE transcripts SET content = $1, updated_at = NOW() WHERE id = $2 AND user_uid = $3',
      [updatedContent, id, userId]
    );

    res.json({
      success: true,
      data: {
        id,
        content: updatedContent,
      },
    });
  } catch (error) {
    console.error('Update Gemini missing data error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

async function followupGeminiSuggestion(req, res) {
  try {
    const userId = req.userId;
    const {id} = req.params;
    const {message, patientId} = req.body;

    if (!message || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Follow-up message is required.',
      });
    }

    const transcript = await dbHelpers.get(
      "SELECT * FROM transcripts WHERE id = $1 AND user_uid = $2 AND source = 'gemini'",
      [id, userId]
    );

    if (!transcript) {
      return res.status(404).json({
        success: false,
        error: 'Gemini suggestion not found.',
      });
    }

    const updatedContent = await generateGeminiFollowup({
      previousResponse: transcript.content,
      followupText: message,
      patientId: patientId || transcript.patient_id,
    });

    await dbHelpers.run(
      'UPDATE transcripts SET content = $1, updated_at = NOW() WHERE id = $2 AND user_uid = $3',
      [updatedContent, id, userId]
    );

    res.json({
      success: true,
      data: {
        id,
        content: updatedContent,
      },
    });
  } catch (error) {
    console.error('Follow-up Gemini suggestion error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

module.exports = {
  getTranscripts,
  getTranscript,
  saveTranscript,
  getLatestGeminiSuggestion,
  getGeminiSuggestions,
  markGeminiSuggestionComplete,
  updateGeminiMissingData,
  followupGeminiSuggestion,
};
