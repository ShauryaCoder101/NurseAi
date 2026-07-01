#!/usr/bin/env node
/**
 * Batch Proforma Generation Script
 * ==================================
 * For each of the 88 completed cases, downloads the ORIGINAL Phase 1 audio
 * from Supabase (the smaller file), runs it through the 2-step proforma
 * pipeline (Extract → Proforma Gem), and saves the result in the DB.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

// ─── Config ─────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://paxdkwuewfwntpmooddf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'audio';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyARhmz66i7GPmaM878BdiVmDe9obLouAng';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_BASE = process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/models';

const args = process.argv.slice(2);
function getArg(n) { const i = args.indexOf(n); return i !== -1 && args[i+1] ? args[i+1] : null; }
const DRY_RUN = args.includes('--dry-run');
const DB_URL = getArg('--db-url');
const DELAY_MS = 5000; // 5s between Gemini calls

// ─── DB ─────────────────────────────────────────────────────────────────────
function buildPool() {
  const url = DB_URL || process.env.DATABASE_URL;
  if (url) return new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return new Pool({ host: 'localhost', port: 5432, database: 'nurseai', user: 'postgres', password: '' });
}

// ─── Supabase ───────────────────────────────────────────────────────────────
let sb = null;
function getSupabase() {
  if (!sb) sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  return sb;
}

async function listSupabaseFiles(folderPath) {
  const client = getSupabase();
  const { data, error } = await client.storage.from(SUPABASE_BUCKET).list(folderPath);
  if (error) throw new Error(`List failed: ${error.message}`);
  return data || [];
}

async function downloadSupabaseFile(storagePath) {
  const client = getSupabase();
  const { data, error } = await client.storage.from(SUPABASE_BUCKET).download(storagePath);
  if (error) throw new Error(`Download failed: ${error.message}`);
  const arrayBuf = await data.arrayBuffer();
  return Buffer.from(arrayBuf);
}

// ─── Prompts (same as geminiService.js) ─────────────────────────────────────
const EXTRACTION_PROMPT = `Task: Extract specific clinical and demographic data from the following patient-nurse transcript.

Rules:

Strict Format: Use only the headers and labels provided in the example below.

No Narrative: Do not summarize the interaction; only extract the raw data points.

Chief Complaint: This must be a verbatim (word-for-word) quote of the patient explaining their reason for seeking care.

Missing Data: If a specific vital sign or demographic detail is not mentioned in the transcript, write "Not recorded" next to that field.

Formatting: Do NOT use any markdown formatting. No asterisks, no bold (**), no headers (#), no underscores for emphasis. Output clean, readable plain text only.

Output Template:

Demographics

Age: [Extract]
Gender: [Extract]
Occupation: [Extract]

Vitals

Heart Rate (HR): [Value] bpm
Blood Pressure (BP): [Value] mmHg
Temperature: [Value] °C
SpO2: [Value]
Respiratory Rate (RR): [Value] breaths/min

Chief Complaint

[Insert verbatim patient quote here]`;

const PROFORMA_GEM_PROMPT = `Role: You are Proforma Gem, a specialized clinical decision support AI designed to assist Nurse Practitioners and medical students in rural West Bengal, India. Your goal is to optimize the first 5–6 minutes of a patient interview to reach a diagnosis efficiently while ensuring "do-not-miss" conditions are addressed.


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
Formatting: Do NOT use any markdown formatting. No asterisks, no bold (**), no headers (#), no underscores for emphasis. Output clean, readable plain text only. Use dashes (-) for bullet points and line breaks for separation.
Default Logic: For vague complaints, default to high-mortality local etiologies (e.g., Sepsis, Eclampsia, Heat Stroke) until ruled out by STG criteria.
For all symptoms, include Bengali colloquial terms in Bengali script (e.g., instead of just 'breathlessness,' use the Bengali term). Don't include English transliteration.

6. Differential Calibration Table (Mandatory)
Every response MUST conclude with a "Differential Calibration" table.
- Columns: | Potential Diagnosis | Key Indicator | STG Action |
- Content: Include at least 3–4 differentials ranging from common local presentations to high-mortality "do-not-miss" conditions.
- STG Action: Must specify the immediate clinical step (e.g., specific antibiotic, dosage, or urgent referral criteria) as per NHM/GoI guidelines.`;

// ─── Gemini Calls ───────────────────────────────────────────────────────────
async function callGemini(parts) {
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
  };
  const endpoint = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!resp.ok) {
    const err = await resp.text();
    if (resp.status === 429) throw { rateLimited: true, message: 'Rate limited' };
    throw new Error(`Gemini (${resp.status}): ${err.substring(0, 200)}`);
  }
  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n').trim() || '';
}

async function generateProforma(audioBase64, mimeType, patientId) {
  // Step 1: Extract clinical data from audio
  const extractionPrompt = `${EXTRACTION_PROMPT}\n\nPatient ID: ${patientId}\n`;
  const extractedText = await callGemini([
    { text: extractionPrompt },
    { inlineData: { mimeType, data: audioBase64 } },
  ]);
  if (!extractedText.trim()) throw new Error('Extraction returned empty');

  // Step 2: Generate proforma from extracted data
  await sleep(2000); // Small delay between the 2 Gemini calls
  const proformaPrompt = `${PROFORMA_GEM_PROMPT}\n\nExtracted Patient Data:\n${extractedText.trim()}`;
  const proformaText = await callGemini([{ text: proformaPrompt }]);

  return { extractedText: extractedText.trim(), proformaText: proformaText.trim() };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  NurseAI — Batch Proforma Generation');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Mode:   ${DRY_RUN ? '🔍 DRY RUN' : '🚀 LIVE'}`);
  console.log(`  Model:  ${GEMINI_MODEL}\n`);

  const pool = buildPool();
  await pool.query('SELECT 1');
  console.log('✅ Connected to DB');

  // Add proforma columns if not exist
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audio_records' AND column_name='proforma_text') THEN
        ALTER TABLE audio_records ADD COLUMN proforma_text TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audio_records' AND column_name='extracted_data') THEN
        ALTER TABLE audio_records ADD COLUMN extracted_data TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audio_records' AND column_name='proforma_status') THEN
        ALTER TABLE audio_records ADD COLUMN proforma_status VARCHAR(50) DEFAULT 'pending';
      END IF;
    END $$;
  `);
  console.log('✅ DB columns verified\n');

  // Get the 88 completed cases
  const { rows: cases } = await pool.query(
    `SELECT id, patient_id, storage_path, file_name, proforma_status
     FROM audio_records
     WHERE transcript_status = 'completed'
     ORDER BY created_at`
  );
  console.log(`📋 Found ${cases.length} completed cases\n`);

  const stats = { generated: 0, skipped: 0, noOriginal: 0, errors: 0 };

  for (let i = 0; i < cases.length; i++) {
    const rec = cases[i];
    const progress = `[${i + 1}/${cases.length}]`;
    process.stdout.write(`  ${progress} ${rec.patient_id}...`);

    try {
      // Skip if already has proforma
      if (rec.proforma_status === 'completed') {
        console.log(' ⏭️  SKIPPED (already has proforma)');
        stats.skipped++;
        continue;
      }

      // List files in this record's Supabase folder to find original (smaller) audio
      const folder = `audio_records/${rec.id}`;
      const files = await listSupabaseFiles(folder);
      const audioFiles = files
        .filter(f => /\.(mp3|m4a|wav|ogg|aac|mp4|webm)$/i.test(f.name))
        .sort((a, b) => {
          // Sort by size (metadata.size) — smallest first
          const sizeA = a.metadata?.size || a.metadata?.contentLength || 999999999;
          const sizeB = b.metadata?.size || b.metadata?.contentLength || 999999999;
          return sizeA - sizeB;
        });

      if (audioFiles.length < 2) {
        // Only 1 file — that's the full audio we uploaded, no original exists
        console.log(` ⚠️  Only ${audioFiles.length} file(s) in Supabase — no original Phase 1 audio`);
        stats.noOriginal++;
        continue;
      }

      // The SMALLER file is the original Phase 1 audio
      const originalFile = audioFiles[0];
      const fullFile = audioFiles[audioFiles.length - 1];
      const origSize = ((originalFile.metadata?.size || 0) / 1024 / 1024).toFixed(1);
      const fullSize = ((fullFile.metadata?.size || 0) / 1024 / 1024).toFixed(1);

      if (DRY_RUN) {
        console.log(` ✅ WOULD PROCESS original "${originalFile.name}" (${origSize}MB) [full: ${fullSize}MB]`);
        stats.generated++;
        continue;
      }

      // Download the original audio from Supabase
      const storagePath = `${folder}/${originalFile.name}`;
      const audioBuffer = await downloadSupabaseFile(storagePath);
      const audioBase64 = audioBuffer.toString('base64');

      const ext = path.extname(originalFile.name).toLowerCase();
      const mimeMap = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.mp4': 'audio/mp4', '.webm': 'audio/webm' };
      const mimeType = mimeMap[ext] || 'audio/mpeg';

      // Mark as processing
      await pool.query(`UPDATE audio_records SET proforma_status = 'processing' WHERE id = $1`, [rec.id]);

      // Generate proforma (2-step: extract → proforma)
      let result;
      let retries = 0;
      while (true) {
        try {
          result = await generateProforma(audioBase64, mimeType, rec.patient_id);
          break;
        } catch (err) {
          if (err.rateLimited && retries < 3) {
            retries++;
            process.stdout.write(' ⏳ Rate limited...');
            await sleep(30000);
            continue;
          }
          throw err;
        }
      }

      // Save to DB
      await pool.query(
        `UPDATE audio_records
         SET proforma_text = $1, extracted_data = $2, proforma_status = 'completed'
         WHERE id = $3`,
        [result.proformaText, result.extractedText, rec.id]
      );

      const words = result.proformaText.split(/\s+/).length;
      console.log(` ✅ Proforma generated (${words} words, orig: ${origSize}MB)`);
      stats.generated++;

      if (i < cases.length - 1) await sleep(DELAY_MS);

    } catch (err) {
      console.log(` ❌ Error: ${err.message || err}`);
      await pool.query(
        `UPDATE audio_records SET proforma_status = 'error' WHERE id = $1`, [rec.id]
      ).catch(() => {});
      stats.errors++;
      if (err.rateLimited) { await sleep(60000); }
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Total completed cases:        ${cases.length}`);
  console.log(`  Proformas generated:           ${stats.generated}`);
  console.log(`  Skipped (already done):        ${stats.skipped}`);
  console.log(`  No original audio found:       ${stats.noOriginal}`);
  console.log(`  Errors:                        ${stats.errors}`);

  await pool.end();
  console.log('\nDone! 🎉');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
