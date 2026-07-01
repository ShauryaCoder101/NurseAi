#!/usr/bin/env node
/**
 * Fix Male Voice Cases — Pick the SMALLER audio (nurse) instead of larger (doctor)
 * Re-uploads to Supabase, updates DB, and re-transcribes.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

// ─── Configuration ──────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://paxdkwuewfwntpmooddf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'audio';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyARhmz66i7GPmaM878BdiVmDe9obLouAng';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_API_BASE_URL = process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/models';

const SRC_BASE = 'C:\\Users\\Shaurya\\Desktop\\full_audios\\RawData_Birbhum';
const SYNCED_DIR = 'C:\\Users\\Shaurya\\Desktop\\synced_audios';

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
const DRY_RUN = args.includes('--dry-run');
const DB_URL = getArg('--db-url');
const DELAY_MS = 4000;

// The 11 male-voice cases
const MALE_VOICE_CASES = [
  'BRD1050', 'BRD1059', 'BRD1061',
  'BRS5125', 'BRS5129', 'BRS5132', 'BRS5136',
  'BRS5152', 'BRS5157', 'BRS5166', 'BRS5169',
];

// ─── DB ─────────────────────────────────────────────────────────────────────
function buildPool() {
  const dbUrl = DB_URL || process.env.DATABASE_URL;
  if (dbUrl) return new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'nurseai',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });
}

// ─── Supabase ───────────────────────────────────────────────────────────────
let supabase = null;
function getSupabase() {
  if (!supabase && SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  }
  return supabase;
}

async function uploadToSupabase(filePath, storagePath) {
  const client = getSupabase();
  if (!client) throw new Error('Supabase not configured');
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.mp4': 'audio/mp4', '.webm': 'audio/webm' };
  const mimeType = mimeMap[ext] || 'audio/mpeg';

  const { error } = await client.storage.from(SUPABASE_BUCKET).upload(storagePath, buffer, { contentType: mimeType, upsert: true });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data } = client.storage.from(SUPABASE_BUCKET).getPublicUrl(storagePath);
  return { publicUrl: data?.publicUrl || null, mimeType };
}

// ─── Gemini Transcription ───────────────────────────────────────────────────
const PROMPT = `You are a medical audio translator and gender detector. Listen to this audio recording and perform TWO tasks:

TASK 1 — GENDER DETECTION:
Determine the gender of the PRIMARY healthcare worker (the person asking questions).
- FEMALE → NURSE recording (CORRECT)
- MALE → DOCTOR recording (WRONG FILE)

TASK 2 — FULL TRANSCRIPTION:
Produce a FULLY TRANSLATED English transcript. Translate from Hindi/Bengali/Bhojpuri to proper English. Label speakers as "Nurse:" or "Patient:" or "Doctor:". Preserve all medical details. Mark unclear parts as [inaudible].

OUTPUT FORMAT:
Line 1: Either "SPEAKER_GENDER: FEMALE" or "SPEAKER_GENDER: MALE"
Line 2: Empty line
Line 3+: The full English transcript`;

async function transcribe(audioBase64, mimeType) {
  const body = {
    contents: [{ role: 'user', parts: [
      { text: PROMPT },
      { inlineData: { mimeType: mimeType || 'audio/mpeg', data: audioBase64 } },
    ]}],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
  };
  const endpoint = `${GEMINI_API_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const resp = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!resp.ok) {
    const err = await resp.text();
    if (resp.status === 429) { throw { rateLimited: true, message: 'Rate limited' }; }
    throw new Error(`Gemini error (${resp.status}): ${err.substring(0, 200)}`);
  }
  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n').trim() || '';
}

function parseResult(raw) {
  const lines = raw.split('\n');
  const gl = lines.find(l => l.trim().startsWith('SPEAKER_GENDER:'));
  let isMale = false, transcript = raw;
  if (gl) {
    isMale = gl.toUpperCase().includes('MALE') && !gl.toUpperCase().includes('FEMALE');
    const idx = lines.indexOf(gl);
    let start = idx + 1;
    while (start < lines.length && lines[start].trim() === '') start++;
    transcript = lines.slice(start).join('\n').trim();
  }
  return { isMale, transcript };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Fix Male Voice Cases — Pick Smaller Audio');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Cases:  ${MALE_VOICE_CASES.length}`);
  console.log(`  Mode:   ${DRY_RUN ? '🔍 DRY RUN' : '🚀 LIVE'}\n`);

  const pool = buildPool();
  await pool.query('SELECT 1');
  console.log('✅ Connected to DB\n');

  const stats = { fixed: 0, stillMale: 0, errors: 0 };

  for (let i = 0; i < MALE_VOICE_CASES.length; i++) {
    const patientId = MALE_VOICE_CASES[i];
    process.stdout.write(`  [${i + 1}/${MALE_VOICE_CASES.length}] ${patientId}...`);

    try {
      // Find DB record
      const dbRes = await pool.query(
        `SELECT id, file_name, file_size FROM audio_records WHERE UPPER(patient_id) IN ($1, $2) ORDER BY created_at DESC LIMIT 1`,
        [patientId, `NUR-${patientId}`]
      );
      if (!dbRes.rows.length) { console.log(' ⚠️  No DB record'); stats.errors++; continue; }
      const record = dbRes.rows[0];

      // Find the SMALLER audio in the patient's folder
      const folder = path.join(SRC_BASE, patientId);
      if (!fs.existsSync(folder)) { console.log(' ⚠️  Folder not found'); stats.errors++; continue; }

      const audioFiles = fs.readdirSync(folder)
        .filter(f => /\.(mp3|m4a|wav|ogg|aac|mp4|webm)$/i.test(f))
        .map(f => ({ name: f, path: path.join(folder, f), size: fs.statSync(path.join(folder, f)).size }))
        .sort((a, b) => a.size - b.size); // SMALLEST first

      if (audioFiles.length < 2) { console.log(' ⚠️  Only 1 audio file'); stats.errors++; continue; }

      const nurseAudio = audioFiles[0]; // Smallest = nurse for these cases
      const doctorAudio = audioFiles[audioFiles.length - 1];
      const nurseMB = (nurseAudio.size / 1024 / 1024).toFixed(1);
      const doctorMB = (doctorAudio.size / 1024 / 1024).toFixed(1);

      if (DRY_RUN) {
        console.log(` ✅ Would swap: "${doctorAudio.name}" (${doctorMB}MB) → "${nurseAudio.name}" (${nurseMB}MB)`);
        stats.fixed++;
        continue;
      }

      // 1. Upload smaller audio to Supabase
      const storagePath = `audio_records/${record.id}/${nurseAudio.name}`;
      const { publicUrl, mimeType } = await uploadToSupabase(nurseAudio.path, storagePath);

      // 2. Update DB with new file
      await pool.query(
        `UPDATE audio_records SET file_url = $1, storage_path = $2, file_size = $3, mime_type = $4, file_name = $5 WHERE id = $6`,
        [publicUrl, storagePath, nurseAudio.size, mimeType, nurseAudio.name, record.id]
      );

      // 3. Copy to synced_audios folder (replace old file)
      fs.copyFileSync(nurseAudio.path, path.join(SYNCED_DIR, nurseAudio.name));

      // 4. Transcribe with Gemini
      const audioBase64 = fs.readFileSync(nurseAudio.path).toString('base64');
      const raw = await transcribe(audioBase64, mimeType);
      const { isMale, transcript } = parseResult(raw);

      if (isMale) {
        await pool.query(
          `UPDATE audio_records SET transcript_status = 'error_male_voice', transcript_error = 'Still detected as male after swap', full_audio_transcript = $1 WHERE id = $2`,
          [transcript, record.id]
        );
        console.log(` 🚨 STILL MALE after swap (${doctorMB}MB → ${nurseMB}MB)`);
        stats.stillMale++;
      } else {
        await pool.query(
          `UPDATE audio_records SET transcript_status = 'completed', transcript_error = NULL, full_audio_transcript = $1 WHERE id = $2`,
          [transcript, record.id]
        );
        const words = transcript.split(/\s+/).length;
        console.log(` ✅ FIXED! Swapped & transcribed (${nurseMB}MB, ${words} words)`);
        stats.fixed++;
      }

      if (i < MALE_VOICE_CASES.length - 1) await sleep(DELAY_MS);

    } catch (err) {
      console.log(` ❌ Error: ${err.message || err}`);
      stats.errors++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Fixed (nurse voice confirmed):  ${stats.fixed}`);
  console.log(`  Still male after swap:           ${stats.stillMale}`);
  console.log(`  Errors:                          ${stats.errors}`);

  await pool.end();
  console.log('\nDone! 🎉');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
