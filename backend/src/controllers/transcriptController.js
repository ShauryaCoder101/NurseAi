// Transcript Controller
const {v4: uuidv4} = require('uuid');
const {dbHelpers} = require('../config/database');

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
    const {content, title, patientName, patientId} = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Transcript content is required.',
      });
    }

    const transcriptId = uuidv4();
    const now = new Date().toISOString();

    await dbHelpers.run(
      'INSERT INTO transcripts (id, user_uid, title, content, patient_name, patient_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [transcriptId, userId, title || null, content, patientName || null, patientId || null, now, now]
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

module.exports = {
  getTranscripts,
  getTranscript,
  saveTranscript,
};
