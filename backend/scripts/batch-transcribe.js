#!/usr/bin/env node
/**
 * Batch Audio Transcription Script
 * =================================
 * Sends all synced nurse audio files to Gemini for transcription,
 * saves transcripts to the DB, and flags male-voice (doctor) audio as errors.
 *
 * Usage:
 *   node scripts/batch-transcribe.js --db-url "postgresql://..."
 *   node scripts/batch-transcribe.js --dry-run   (preview only)
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// ─── Configuration ──────────────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyARhmz66i7GPmaM878BdiVmDe9obLouAng';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_BASE_URL = process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/models';

const AUDIO_DIR = 'C:\\Users\\Shaurya\\Desktop\\synced_audios';
const SYNC_REPORT_PATH = path.join(__dirname, 'sync-report-1781825980534.json');

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
const DRY_RUN = args.includes('--dry-run');
const DB_URL_OVERRIDE = getArg('--db-url');

// Rate limiting: Gemini has RPM limits
const DELAY_BETWEEN_CALLS_MS = 4000; // 4 seconds between calls (15 RPM safe)

// ─── Database Setup ─────────────────────────────────────────────────────────
function buildPool() {
  const dbUrl = DB_URL_OVERRIDE || process.env.DATABASE_URL;
  if (dbUrl) {
    return new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  }
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'nurseai',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });
}

// ─── Gemini Transcription ───────────────────────────────────────────────────
const TRANSCRIPTION_PROMPT = `You are a medical audio translator and gender detector. Listen to this audio recording and perform TWO tasks:

TASK 1 — GENDER DETECTION:
First, determine the gender of the PRIMARY healthcare worker (the person asking questions / conducting the assessment).
- If the primary healthcare worker is FEMALE → this is a NURSE recording (CORRECT)
- If the primary healthcare worker is MALE → this is a DOCTOR recording (WRONG FILE)

TASK 2 — FULL TRANSCRIPTION:
Produce a FULLY TRANSLATED English transcript of the entire conversation.

CRITICAL RULES:
- The audio is likely in Hindi, Bengali, Bhojpuri, or another Indian language.
- TRANSLATE every sentence into PROPER, NATURAL ENGLISH. Do NOT transliterate.
- Label each speaker as "Nurse:" or "Patient:" (or "Doctor:" if applicable).
- Preserve ALL medical details, symptoms, diagnoses, medications accurately.
- Maintain conversational flow and tone.
- If any part is genuinely unclear, mark it as [inaudible].

OUTPUT FORMAT (you MUST follow this exactly):
Line 1: Either "SPEAKER_GENDER: FEMALE" or "SPEAKER_GENDER: MALE"
Line 2: Empty line
Line 3 onwards: The full English transcript

Example:
SPEAKER_GENDER: FEMALE

Nurse: What brings you here today?
Patient: I've been having chest pain for the last 3 days.
Nurse: Can you describe the pain? Is it sharp or dull?
Patient: It's a sharp pain on the left side.`;

async function transcribeWithGemini(audioBase64, mimeType) {
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: TRANSCRIPTION_PROMPT },
        { inlineData: { mimeType: mimeType || 'audio/mpeg', data: audioBase64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
    },
  };

  const endpoint = `${GEMINI_API_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 429) {
      // Rate limited — parse retry-after
      const retryAfter = response.headers.get('retry-after');
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 30000;
      throw { rateLimited: true, waitMs, message: `Rate limited, retry after ${waitMs / 1000}s` };
    }
    throw new Error(`Gemini error (${response.status}): ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n').trim() || '';
  return text;
}

function parseTranscriptionResult(rawText) {
  const lines = rawText.split('\n');
  const genderLine = lines.find(l => l.trim().startsWith('SPEAKER_GENDER:'));

  let isMale = false;
  let transcript = rawText;

  if (genderLine) {
    isMale = genderLine.toUpperCase().includes('MALE') && !genderLine.toUpperCase().includes('FEMALE');
    // Remove the gender line and any empty lines after it from the transcript
    const genderIdx = lines.indexOf(genderLine);
    let startIdx = genderIdx + 1;
    while (startIdx < lines.length && lines[startIdx].trim() === '') startIdx++;
    transcript = lines.slice(startIdx).join('\n').trim();
  }

  return { isMale, transcript };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  NurseAI — Batch Audio Transcription');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Mode:     ${DRY_RUN ? '🔍 DRY RUN' : '🚀 LIVE'}`);
  console.log(`  Model:    ${GEMINI_MODEL}`);
  console.log('');

  // Load sync report
  if (!fs.existsSync(SYNC_REPORT_PATH)) {
    console.error('❌ Sync report not found:', SYNC_REPORT_PATH);
    process.exit(1);
  }
  const syncReport = JSON.parse(fs.readFileSync(SYNC_REPORT_PATH, 'utf8'));
  const syncedCases = syncReport.filter(r => r.status === 'REPLACED');
  console.log(`📋 Found ${syncedCases.length} synced cases from report\n`);

  // Connect to DB
  const pool = buildPool();
  try {
    await pool.query('SELECT 1');
    console.log('✅ Connected to database\n');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1);
  }

  // Ensure full_audio_transcript column exists
  try {
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'audio_records' AND column_name = 'full_audio_transcript'
        ) THEN
          ALTER TABLE audio_records ADD COLUMN full_audio_transcript TEXT;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'audio_records' AND column_name = 'transcript_status'
        ) THEN
          ALTER TABLE audio_records ADD COLUMN transcript_status VARCHAR(50) DEFAULT 'pending';
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'audio_records' AND column_name = 'transcript_error'
        ) THEN
          ALTER TABLE audio_records ADD COLUMN transcript_error TEXT;
        END IF;
      END $$;
    `);
    console.log('✅ DB columns verified\n');
  } catch (err) {
    console.error('❌ Failed to add columns:', err.message);
    process.exit(1);
  }

  // Build a map of patientId → audio file in synced_audios folder
  // We need to match the sync report entries to the actual files
  const audioFiles = fs.readdirSync(AUDIO_DIR).filter(f => /\.(mp3|m4a|wav|ogg|aac|mp4|webm)$/i.test(f));
  console.log(`📂 Found ${audioFiles.length} audio files in synced_audios folder\n`);

  // Build patientId → recordId map and match to files
  // We need to find which file belongs to which patient by re-scanning original folders
  const srcBase = 'C:\\Users\\Shaurya\\Desktop\\full_audios\\RawData_Birbhum';
  const patientFileMap = {};
  for (const item of syncedCases) {
    const folder = path.join(srcBase, item.patientId);
    if (!fs.existsSync(folder)) continue;
    const files = fs.readdirSync(folder).filter(f => /\.(mp3|m4a|wav|ogg|aac|mp4|webm)$/i.test(f));
    let nurFile = files.find(f => /^NUR-/i.test(f));
    if (!nurFile) {
      nurFile = files.sort((a, b) =>
        fs.statSync(path.join(folder, b)).size - fs.statSync(path.join(folder, a)).size
      )[0];
    }
    if (nurFile) {
      patientFileMap[item.patientId] = {
        recordId: item.recordId,
        fileName: nurFile,
        filePath: path.join(AUDIO_DIR, nurFile),
      };
    }
  }

  const toProcess = Object.entries(patientFileMap).filter(([_, v]) => fs.existsSync(v.filePath));
  console.log(`🎯 ${toProcess.length} cases ready for transcription\n`);

  // Check which ones already have transcripts (skip them)
  const stats = { transcribed: 0, maleDetected: 0, skipped: 0, errors: 0, rateLimitWaits: 0 };

  for (let i = 0; i < toProcess.length; i++) {
    const [patientId, info] = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;

    process.stdout.write(`  ${progress} ${patientId}...`);

    try {
      // Check if already transcribed
      const existing = await pool.query(
        `SELECT transcript_status, full_audio_transcript FROM audio_records WHERE id = $1`,
        [info.recordId]
      );
      const record = existing.rows[0];
      if (record?.transcript_status === 'completed' && record?.full_audio_transcript) {
        console.log(` ⏭️  SKIPPED (already transcribed)`);
        stats.skipped++;
        continue;
      }
      if (record?.transcript_status === 'error_male_voice') {
        console.log(` ⏭️  SKIPPED (already flagged as male voice)`);
        stats.skipped++;
        continue;
      }

      if (DRY_RUN) {
        const sizeMB = (fs.statSync(info.filePath).size / 1024 / 1024).toFixed(1);
        console.log(` ✅ WOULD TRANSCRIBE (${sizeMB}MB)`);
        stats.transcribed++;
        continue;
      }

      // Read audio file and convert to base64
      const audioBuffer = fs.readFileSync(info.filePath);
      const audioBase64 = audioBuffer.toString('base64');
      const ext = path.extname(info.fileName).toLowerCase();
      const mimeMap = {
        '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav',
        '.mp4': 'audio/mp4', '.webm': 'audio/webm', '.ogg': 'audio/ogg',
      };
      const mimeType = mimeMap[ext] || 'audio/mpeg';

      // Mark as processing
      await pool.query(
        `UPDATE audio_records SET transcript_status = 'processing' WHERE id = $1`,
        [info.recordId]
      );

      // Call Gemini with retry on rate limit
      let rawResult;
      let retries = 0;
      while (true) {
        try {
          rawResult = await transcribeWithGemini(audioBase64, mimeType);
          break;
        } catch (err) {
          if (err.rateLimited && retries < 3) {
            retries++;
            stats.rateLimitWaits++;
            const waitSec = Math.ceil(err.waitMs / 1000);
            process.stdout.write(` ⏳ Rate limited, waiting ${waitSec}s...`);
            await sleep(err.waitMs);
            continue;
          }
          throw err;
        }
      }

      // Parse result
      const { isMale, transcript } = parseTranscriptionResult(rawResult);

      if (isMale) {
        // Male voice detected — flag as error
        await pool.query(
          `UPDATE audio_records
           SET transcript_status = 'error_male_voice',
               transcript_error = 'Male doctor voice detected — wrong audio file. Needs manual replacement.',
               full_audio_transcript = $1
           WHERE id = $2`,
          [transcript, info.recordId]
        );
        console.log(` 🚨 MALE VOICE DETECTED — flagged as error`);
        stats.maleDetected++;
      } else {
        // Female nurse voice — save transcript
        await pool.query(
          `UPDATE audio_records
           SET transcript_status = 'completed',
               transcript_error = NULL,
               full_audio_transcript = $1
           WHERE id = $2`,
          [transcript, info.recordId]
        );
        const wordCount = transcript.split(/\s+/).length;
        console.log(` ✅ Transcribed (${wordCount} words)`);
        stats.transcribed++;
      }

      // Rate limit delay
      if (i < toProcess.length - 1) {
        await sleep(DELAY_BETWEEN_CALLS_MS);
      }

    } catch (err) {
      console.log(` ❌ Error: ${err.message || err}`);
      // Mark error in DB
      if (!DRY_RUN) {
        await pool.query(
          `UPDATE audio_records
           SET transcript_status = 'error',
               transcript_error = $1
           WHERE id = $2`,
          [String(err.message || err).substring(0, 500), info.recordId]
        ).catch(() => {});
      }
      stats.errors++;

      // If rate limited and all retries exhausted, wait longer
      if (err.rateLimited) {
        console.log('   Waiting 60s before continuing...');
        await sleep(60000);
      }
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Total cases:                ${toProcess.length}`);
  console.log(`  Successfully transcribed:    ${stats.transcribed}`);
  console.log(`  Male voice (flagged):        ${stats.maleDetected}`);
  console.log(`  Skipped (already done):      ${stats.skipped}`);
  console.log(`  Errors:                      ${stats.errors}`);
  console.log(`  Rate limit waits:            ${stats.rateLimitWaits}`);
  console.log('');

  if (stats.maleDetected > 0) {
    // List male-voice cases
    const maleCases = await pool.query(
      `SELECT patient_id, id FROM audio_records WHERE transcript_status = 'error_male_voice'`
    );
    console.log(`  🚨 Male voice cases (need manual replacement):`);
    maleCases.rows.forEach(r => console.log(`     - ${r.patient_id} (record: ${r.id.substring(0, 8)}...)`));
  }

  await pool.end();
  console.log('\nDone! 🎉');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
