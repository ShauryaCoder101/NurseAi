const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const {dbHelpers} = require('../config/database');
const {generateGeminiSuggestion, generateBenchmarkResponse} = require('../services/geminiService');
const {uploadAudioFile, isStorageConfigured} = require('../services/supabaseStorage');
const {parseFile} = require('music-metadata');

const AUDIO_UPLOAD_DIR = path.join(__dirname, '../../uploads/audio');
const METRICS_EMAIL = 'shauryasharma2002@gmail.com';
const METRICS_PASSWORD = 'hihihi';
const METRICS_PATIENT_PREFIX = 'metric';
const METRICS_PID_PREFIX = 'TM-';

async function resolveMetricsUserUid() {
  const user = await dbHelpers.get('SELECT uid, password FROM users WHERE email = $1', [METRICS_EMAIL]);
  if (!user) {
    throw new Error(`Metrics user ${METRICS_EMAIL} not found. Register first.`);
  }
  const valid = await bcrypt.compare(METRICS_PASSWORD, user.password);
  if (!valid) {
    throw new Error('Metrics user password mismatch.');
  }
  return user.uid;
}

const PROFORMA_PROMPT_PREFIX =
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
- STG Action: Must specify the immediate clinical step (e.g., specific antibiotic, dosage, or urgent referral criteria) as per NHM/GoI guidelines.`;

function ensureUploadDir() {
  if (!fs.existsSync(AUDIO_UPLOAD_DIR)) {
    fs.mkdirSync(AUDIO_UPLOAD_DIR, {recursive: true});
  }
}

async function runAudioMetrics(req, res) {
  try {
    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({success: false, error: 'No audio files uploaded.'});
    }

    let userUid;
    try {
      userUid = await resolveMetricsUserUid();
    } catch (authErr) {
      return res.status(401).json({success: false, error: authErr.message});
    }

    ensureUploadDir();
    const results = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = file.path.replace(/\\/g, '/');
      const mimeType = file.mimetype || 'audio/mp4';
      const serial = String(i + 1).padStart(3, '0');
      const patientName = `${METRICS_PATIENT_PREFIX}${serial}`;
      const patientId = `${METRICS_PID_PREFIX}${serial}`;
      let durationSec = 0;
      try {
        const metadata = await parseFile(filePath);
        durationSec = metadata?.format?.duration || 0;
      } catch (_) {}

      const entry = {
        fileName: file.originalname,
        fileSize: file.size,
        durationSec: Math.round(durationSec * 10) / 10,
        index: i + 1,
        total: files.length,
        patientName,
        patientId,
        directGemini: {latencyMs: 0, success: false, empty: false, error: null},
        fullPipeline: {latencyMs: 0, success: false, empty: false, error: null},
      };

      // --- Direct Gemini call (pure API latency) ---
      const directStart = Date.now();
      try {
        const directResult = await generateGeminiSuggestion({
          audioPath: filePath,
          mimeType,
          patientId,
        });
        entry.directGemini.latencyMs = Date.now() - directStart;
        if (!directResult || !directResult.trim()) {
          entry.directGemini.empty = true;
        } else {
          entry.directGemini.success = true;
        }
      } catch (err) {
        entry.directGemini.latencyMs = Date.now() - directStart;
        entry.directGemini.error = err?.message || 'Unknown error';
      }

      // --- Full pipeline (file copy, DB insert, Supabase upload, then Gemini) ---
      const pipelineStart = Date.now();
      try {

        const renamedFile = `metrics_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const renamedPath = path.join(AUDIO_UPLOAD_DIR, renamedFile).replace(/\\/g, '/');
        fs.copyFileSync(filePath, renamedPath);

        let recordId = null;
        try {
          const dbResult = await dbHelpers.run(
            `INSERT INTO audio_records
              (user_uid, patient_name, patient_id, file_path, file_name, file_size, mime_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [userUid, patientName, patientId, renamedPath, renamedFile, file.size, mimeType]
          );
          recordId = dbResult.lastID;
        } catch (dbErr) {
          console.warn('Metrics DB insert failed:', dbErr?.message);
        }

        if (recordId && isStorageConfigured()) {
          try {
            const uploadResult = await uploadAudioFile({
              filePath: renamedPath,
              fileName: renamedFile,
              recordId,
              mimeType,
            });
            if (uploadResult) {
              await dbHelpers.run(
                'UPDATE audio_records SET file_url = $1, storage_path = $2 WHERE id = $3',
                [uploadResult.publicUrl, uploadResult.storagePath, recordId]
              );
            }
          } catch (_) {
            // Supabase failure is non-fatal for metrics
          }
        }

        const geminiResult = await generateGeminiSuggestion({
          audioPath: renamedPath,
          mimeType,
          patientId,
        });

        entry.fullPipeline.latencyMs = Date.now() - pipelineStart;
        if (!geminiResult || !geminiResult.trim()) {
          entry.fullPipeline.empty = true;
        } else {
          entry.fullPipeline.success = true;
        }
      } catch (err) {
        entry.fullPipeline.latencyMs = Date.now() - pipelineStart;
        entry.fullPipeline.error = err?.message || 'Unknown error';
      }

      results.push(entry);
    }

    // Cleanup temp files uploaded by multer
    for (const file of files) {
      try { fs.unlinkSync(file.path); } catch (_) {}
    }

    const summary = buildAudioSummary(results);
    res.json({success: true, data: {results, summary}});
  } catch (error) {
    console.error('Metrics audio error:', error);
    res.status(500).json({success: false, error: 'Internal server error.'});
  }
}

async function runProformaMetrics(req, res) {
  try {
    const {symptoms} = req.body || {};

    if (!Array.isArray(symptoms) || symptoms.length === 0) {
      return res.status(400).json({success: false, error: 'Provide an array of symptom strings.'});
    }

    const results = [];

    for (const symptomText of symptoms) {
      const trimmed = String(symptomText || '').trim();
      if (!trimmed) continue;

      const entry = {
        symptoms: trimmed,
        latencyMs: 0,
        success: false,
        empty: false,
        error: null,
      };

      try {
        const prompt = `${PROFORMA_PROMPT_PREFIX}\n\nSymptoms: ${trimmed}`;
        const start = Date.now();
        const content = await generateBenchmarkResponse({promptText: prompt});
        entry.latencyMs = Date.now() - start;

        if (!content || !content.trim()) {
          entry.empty = true;
        } else {
          entry.success = true;
        }
      } catch (err) {
        entry.error = err?.message || 'Unknown error';
      }

      results.push(entry);
    }

    const summary = buildProformaSummary(results);
    res.json({success: true, data: {results, summary}});
  } catch (error) {
    console.error('Metrics proforma error:', error);
    res.status(500).json({success: false, error: 'Internal server error.'});
  }
}

function buildAudioSummary(results) {
  const directLatencies = results.filter((r) => r.directGemini.success).map((r) => r.directGemini.latencyMs);
  const pipelineLatencies = results.filter((r) => r.fullPipeline.success).map((r) => r.fullPipeline.latencyMs);
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

  return {
    totalFiles: results.length,
    directAvgMs: avg(directLatencies),
    pipelineAvgMs: avg(pipelineLatencies),
    overheadAvgMs: avg(pipelineLatencies) - avg(directLatencies),
    directFailures: results.filter((r) => !r.directGemini.success).length,
    pipelineFailures: results.filter((r) => !r.fullPipeline.success).length,
    directEmpty: results.filter((r) => r.directGemini.empty).length,
    pipelineEmpty: results.filter((r) => r.fullPipeline.empty).length,
  };
}

function buildProformaSummary(results) {
  const latencies = results.filter((r) => r.success).map((r) => r.latencyMs);
  const avg = (arr) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0);

  return {
    totalSymptoms: results.length,
    avgLatencyMs: avg(latencies),
    failures: results.filter((r) => !r.success).length,
    empty: results.filter((r) => r.empty).length,
  };
}

module.exports = {
  runAudioMetrics,
  runProformaMetrics,
};
