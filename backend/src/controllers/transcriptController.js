// Transcript Controller
const {v4: uuidv4} = require('uuid');
const {dbHelpers} = require('../config/database');
const {generateGeminiFollowup, generateProformaResponse} = require('../services/geminiService');
const {fetchPatientHistory} = require('./audioController');
const {regeneratePatientHtml} = require('../services/patientRecordHtmlService');

// Get all transcripts
async function getTranscripts(req, res) {
  try {
    const userId = req.userId;
    const {patientName, patientId} = req.query;

    // Build query with optional filters
    // Exclude flagged visits from the nurse's primary view
    let query = "SELECT * FROM transcripts WHERE user_uid = $1 AND verification_status != 'flagged'";
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
    const formattedTranscripts = transcripts.map((transcript) => {
      const content = transcript.content || '';
      const createdAtValue = transcript.created_at;
      const createdAtDate = createdAtValue ? new Date(createdAtValue) : null;
      const hasValidDate = createdAtDate && !Number.isNaN(createdAtDate.getTime());
      const titleDate = hasValidDate ? createdAtDate.toLocaleDateString() : 'Unknown date';
      const date = hasValidDate ? createdAtDate.toISOString().split('T')[0] : '';

      return {
        id: transcript.id,
        title: transcript.title || `${transcript.patient_name || 'Untitled'} - ${titleDate}`,
        date,
        preview: content.substring(0, 100) + (content.length > 100 ? '...' : ''),
        patientName: transcript.patient_name,
        patientId: transcript.patient_id,
        content,
        source: transcript.source || 'manual',
        audioRecordId: transcript.audio_record_id || null,
        suggestionCompleted: transcript.suggestion_completed || false,
        verificationStatus: transcript.verification_status,
      };
    });

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
        completed: transcript.suggestion_completed,
        createdAt: transcript.created_at,
        updatedAt: transcript.updated_at,
        verificationStatus: transcript.verification_status,
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

// Reopen a completed Gemini suggestion
async function reopenGeminiSuggestion(req, res) {
  try {
    const userId = req.userId;
    const {id} = req.params;

    await dbHelpers.run(
      `UPDATE transcripts
       SET suggestion_completed = FALSE, updated_at = NOW()
       WHERE id = $1 AND user_uid = $2 AND source = 'gemini'`,
      [id, userId]
    );

    res.json({success: true});
  } catch (error) {
    console.error('Reopen Gemini suggestion error:', error);
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

    const effectivePatientId = patientId || transcript.patient_id;

    // Fetch full patient history for stateful follow-up
    const patientHistory = await fetchPatientHistory(effectivePatientId);

    const followupResult = await generateGeminiFollowup({
      previousResponse: transcript.content,
      followupText: message,
      patientId: effectivePatientId,
      patientHistory,
    });

    const updatedContent = followupResult.text || followupResult;
    const followupReasoning = followupResult.reasoning || null;
    const followupModel = followupResult.modelUsed || null;

    // We no longer update the main transcript content with the follow-up answer.
    // The original prescription/diagnosis remains intact.
    // The follow-up interaction is saved purely in the followup_log.

    // Log the follow-up interaction for audit trail
    try {
      await dbHelpers.run(
        `INSERT INTO followup_log
          (transcript_id, user_uid, patient_id, message, previous_content, updated_content)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          userId,
          effectivePatientId || null,
          message,
          transcript.content,
          updatedContent,
        ]
      );
    } catch (logErr) {
      console.error('Failed to save follow-up log:', logErr);
    }

    // Save AI reasoning audit log for follow-up
    if (followupReasoning) {
      try {
        await dbHelpers.run(
          `INSERT INTO ai_reasoning_log
            (transcript_id, audio_record_id, patient_id, stage, input_summary, reasoning_steps, output_summary, model_used)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id,
            transcript.audio_record_id || null,
            effectivePatientId || null,
            'followup',
            followupReasoning.input_summary || null,
            JSON.stringify(followupReasoning.steps || followupReasoning),
            followupReasoning.output_summary || null,
            followupModel,
          ]
        );
      } catch (reasoningErr) {
        console.error('Failed to save follow-up reasoning:', reasoningErr);
      }
    }

    // Regenerate patient HTML file after follow-up
    if (effectivePatientId) {
      regeneratePatientHtml(userId, effectivePatientId).catch((e) =>
        console.error('HTML regen error (followup):', e)
      );
    }

    res.json({
      success: true,
      data: {
        id,
        content: transcript.content, // Return original content
        followupAnswer: updatedContent, // Return the new standalone answer
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

async function generateProforma(req, res) {
  try {
    const {symptoms} = req.body || {};
    const trimmed = String(symptoms || '').trim();
    if (!trimmed) {
      return res.status(400).json({
        success: false,
        error: 'Symptoms are required.',
      });
    }

    const prompt =
      `Role: You are Proforma Gem, a specialized clinical decision support AI designed to assist Nurse Practitioners and medical students in rural West Bengal, India. Your goal is to optimize the first 5–6 minutes of a patient interview to reach a diagnosis efficiently while ensuring "do-not-miss" conditions are addressed.


Contextual Awareness:
Geography: Rural West Bengal. Consider local endemicity (e.g., Scrub Typhus, Malaria, Japanese Encephalitis, Visceral Leishmaniasis, etc.).
Temporality: Always check the current month and year. Adjust differentials based on seasonal peaks (e.g., pre-monsoon, monsoon, winter).

Constraints: The initial interview is capped at 6 minutes. You have one follow-up opportunity for clarifying questions.

STG-Integration Protocol (Mandatory):
Mandatory Search: For every presenting complaint, you must first identify the relevant Standard Treatment Guidelines (STGs) from the Government of India (GoI), National Health Mission (NHM), or WHO (e.g., "NHM STG for Neonatal Sepsis", "Anemia Mukt Bharat", or "ICMR Diabetes Guidelines").
Calibration: Use STGs to define "Must-Ask" questions and physiological thresholds (e.g., Respiratory Rate limits, BP cut-offs).
Preventative Check: For ANC or pediatric visits, cross-reference the National Immunization Schedule and mandatory supplementation protocols (e.g., IFA, Vitamin A, Albendazole).


Response Format: Generate a comprehensive Proforma Interview Guide organized into these sections:
1. HPI: The Core Narrative
Use SOCRATES for pain or OPQRST for functional complaints.
Frame as patient-centered questions exploring illness trajectory
2. Expanded ROS & Red Flags (STG-Informed)
List "Must-Ask" questions for the specific system involved.
Highlight 3–5 "Stop-Sign" Symptoms requiring immediate referral based on STG danger signs (e.g., Inability to feed, convulsions, or severe epigastric pain).
In the Expanded ROS section, always include broad, systemic questions (Weight loss, Fever, Fatigue, Appetite, etc) regardless of the chief complaint to screen for undiagnosed chronic conditions such as infections, cancer, endocrine, rheumatologic diseases, anemia, cardiopulmonary symptoms etc. Things that are common in the age group specified.
3. Social & Environmental factors (as relevant to the presenting complaints.)
Water/Sanitation: Drinking source (Tube well vs. Pond), open defecation, and monsoon flooding.
Occupational/Zoonotic: Rice paddy work (Lepto), livestock exposure, or stagnant water.
Nutritional: Dietary diversity (Iron/Protein), Pica (clay/mud eating), and cooking fuel (biomass smoke).
Tobacco and alcohol use
sexual history, only if relevant to the presenting complaint.
4. History & "Rural Pharmacy" Check
GPLA & Obstetric History: (If applicable) Gravida, Para, Living, Abortion, and birth interval.
TB/Malaria/HIV Screen: Previous incomplete treatment courses.
The "Quack" Inquiry: Specific questions about "loose" pills, local herbal remedies, or "gas" medicine from non-medical shops.
5. High-Yield Physical Exam & Vitals
Vitals: Include Shock Index (HR/SBP) or Capillary Refill Time -- only if relevant.
Maneuvers: 3–5 signs (e.g., Bitot's spots, Splenomegaly, Basal Crepitations, or checking for Pedal Edema)--whatever is relevant.



Operational Instructions:
Tone: Authentic, supportive, clinical, and peer-like.
Formatting: Use Markdown (bolding, headers) for scannability.
Default Logic: For vague complaints, default to high-mortality local etiologies (e.g., Sepsis, Eclampsia, Heat Stroke) until ruled out by STG criteria.
For all symptoms, include Bengali colloquial terms in Bengali script (e.g., instead of just 'breathlessness,' use the Bengali term). Don't include English transliteration.

6. Differential Calibration Table (Mandatory)
Every response MUST conclude with a "Differential Calibration" table.
- Columns: | Potential Diagnosis | Key Indicator | STG Action |
- Content: Include at least 3–4 differentials ranging from common local presentations to high-mortality "do-not-miss" conditions.
- STG Action: Must specify the immediate clinical step (e.g., specific antibiotic, dosage, or urgent referral criteria) as per NHM/GoI guidelines.` +
      `\n\nSymptoms: ${trimmed}`;

    const content = await generateProformaResponse({promptText: prompt});
    if (!content || !content.trim()) {
      return res.status(502).json({
        success: false,
        error: 'Gemini returned an empty response.',
      });
    }

    res.json({
      success: true,
      data: {
        content: content.trim(),
      },
    });
  } catch (error) {
    console.error('Generate proforma error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

// Flag a Gemini suggestion for review
async function flagGeminiSuggestion(req, res) {
  try {
    const userId = req.userId;
    const {id} = req.params;
    const {reason} = req.body || {};

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

    if (transcript.suggestion_completed) {
      return res.status(400).json({
        success: false,
        error: 'Only pending Gemini suggestions can be flagged.',
      });
    }

    const insertResult = await dbHelpers.run(
      `INSERT INTO flagged_suggestions
        (transcript_id, audio_record_id, user_uid, patient_id, content, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (transcript_id) DO NOTHING`,
      [
        transcript.id,
        transcript.audio_record_id || null,
        userId,
        transcript.patient_id || null,
        transcript.content || '',
        reason && String(reason).trim().length > 0 ? String(reason).trim() : null,
      ]
    );

    const flagged = await dbHelpers.get(
      `SELECT * FROM flagged_suggestions WHERE transcript_id = $1 AND user_uid = $2`,
      [transcript.id, userId]
    );

    res.json({
      success: true,
      data: {
        id: flagged?.id || null,
        transcriptId: transcript.id,
        audioRecordId: flagged?.audio_record_id || transcript.audio_record_id || null,
        patientId: flagged?.patient_id || transcript.patient_id || null,
        userUid: flagged?.user_uid || userId,
        reason: flagged?.reason || null,
        flaggedAt: flagged?.flagged_at || null,
        alreadyFlagged: insertResult.changes === 0,
      },
    });
  } catch (error) {
    console.error('Flag Gemini suggestion error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

async function getGroupedTranscripts(req, res) {
  try {
    const userId = req.userId;
    const rows = await dbHelpers.all(
      `SELECT id, title, content, patient_name, patient_id, source,
              audio_record_id, suggestion_completed, created_at, verification_status
       FROM transcripts
       WHERE user_uid = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    const groupMap = new Map();
    for (const row of rows) {
      const key = row.patient_id || row.patient_name || 'unknown';
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          patientId: row.patient_id || null,
          patientName: row.patient_name || null,
          latestDate: row.created_at,
          transcripts: [],
        });
      }
      groupMap.get(key).transcripts.push({
        id: row.id,
        title: row.title,
        content: row.content,
        source: row.source,
        audioRecordId: row.audio_record_id,
        suggestionCompleted: row.suggestion_completed,
        createdAt: row.created_at,
        verificationStatus: row.verification_status,
      });
    }

    const groups = Array.from(groupMap.values()).map((g) => ({
      ...g,
      visitCount: g.transcripts.length,
    }));

    res.json({success: true, data: groups});
  } catch (error) {
    console.error('Get grouped transcripts error:', error);
    res.status(500).json({success: false, error: 'Internal server error.'});
  }
}

module.exports = {
  getTranscripts,
  getTranscript,
  saveTranscript,
  getLatestGeminiSuggestion,
  getGeminiSuggestions,
  markGeminiSuggestionComplete,
  reopenGeminiSuggestion,
  updateGeminiMissingData,
  followupGeminiSuggestion,
  flagGeminiSuggestion,
  generateProforma,
  getGroupedTranscripts,
};
