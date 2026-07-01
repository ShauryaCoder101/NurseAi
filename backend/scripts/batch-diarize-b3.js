#!/usr/bin/env node
/**
 * Batch Diarized Transcript Generation for Benchmark-3
 * =====================================================
 * Downloads full audio from Supabase for B3 cases, sends to Gemini
 * for diarized transcription, and updates bench_pres.transcript.
 */

const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

// Config
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyARhmz66i7GPmaM878BdiVmDe9obLouAng';
const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'audio';

const DB_URL = process.env.DATABASE_URL;
const DELAY_MS = 5000;

const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DIARIZE_PROMPT = `You are a medical audio transcriptionist. Listen to this audio recording and produce a FULLY DIARIZED English transcript.

INSTRUCTIONS:
- The audio is a clinical consultation between a nurse and a patient, likely in Hindi, Bengali, Bhojpuri, or another Indian language.
- TRANSLATE every sentence into PROPER, NATURAL ENGLISH. Do NOT transliterate.
- Label each speaker clearly as "Nurse:" or "Patient:" on each line.
- Preserve ALL medical details: symptoms, duration, medications, vitals, history — accurately.
- Maintain the conversational flow and chronological order.
- If any part is genuinely unclear, mark it as [inaudible].
- Do NOT add any analysis, diagnosis, or prescription — just the raw transcript.

OUTPUT FORMAT:
Nurse: [translated speech]
Patient: [translated speech]
Nurse: [translated speech]
...

Begin the transcript immediately, no preamble.`;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function downloadAudioFromSupabase(storagePath) {
  const { data, error } = await supabase.storage
    .from(SUPABASE_STORAGE_BUCKET)
    .download(storagePath);
  if (error) throw new Error(`Supabase download failed: ${error.message}`);
  const buffer = Buffer.from(await data.arrayBuffer());
  return buffer.toString('base64');
}

async function transcribeWithGemini(audioBase64, mimeType) {
  const body = {
    contents: [{
      role: 'user',
      parts: [
        { text: DIARIZE_PROMPT },
        { inlineData: { mimeType: mimeType || 'audio/mp4', data: audioBase64 } },
      ],
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 16384,
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
      const retryAfter = response.headers.get('retry-after');
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
      throw { rateLimited: true, waitMs, message: `Rate limited, retry after ${waitMs / 1000}s` };
    }
    throw new Error(`Gemini ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('\n').trim() || '';
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  NurseAI — B3 Diarized Transcript Generation');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Model: ${GEMINI_MODEL}\n`);

  // Get all B3 bench records with their audio paths
  const cases = await pool.query(`
    SELECT br.id as bench_id, br.file_name, br.local_path, br.mime_type,
           br.source_audio_record_id,
           ar.storage_path, ar.full_audio_storage_path
    FROM bench_records br
    JOIN bench_pres bp ON bp.bench_record_id = br.id
    LEFT JOIN audio_records ar ON ar.id = br.source_audio_record_id
    WHERE br.batch = 'benchmark-3'
    ORDER BY br.created_at
  `);

  console.log(`📋 Found ${cases.rows.length} B3 cases\n`);

  let ok = 0, errors = 0, skipped = 0;

  for (let i = 0; i < cases.rows.length; i++) {
    const c = cases.rows[i];
    const label = c.file_name || c.bench_id;
    process.stdout.write(`  [${i + 1}/${cases.rows.length}] ${label.substring(0, 30)}... `);

    // Use full audio if available, otherwise main audio
    const audioPath = c.full_audio_storage_path || c.storage_path || c.local_path;
    if (!audioPath) {
      console.log('❌ No audio path found');
      errors++;
      continue;
    }

    try {
      // Download audio from Supabase
      const audioBase64 = await downloadAudioFromSupabase(audioPath);
      const sizeMB = (Buffer.byteLength(audioBase64, 'base64') / 1024 / 1024).toFixed(1);

      // Transcribe with Gemini
      const transcript = await transcribeWithGemini(audioBase64, c.mime_type || 'audio/mp4');

      if (!transcript || transcript.length < 20) {
        console.log(`⚠️  Empty/short transcript (${transcript.length} chars)`);
        errors++;
        await sleep(DELAY_MS);
        continue;
      }

      const wordCount = transcript.split(/\s+/).length;

      // Update bench_pres with diarized transcript
      await pool.query(
        'UPDATE bench_pres SET transcript = $1 WHERE bench_record_id = $2',
        [transcript, c.bench_id]
      );

      console.log(`✅ ${wordCount} words (audio: ${sizeMB}MB)`);
      ok++;
    } catch (err) {
      if (err.rateLimited) {
        console.log(`⏳ Rate limited, waiting ${err.waitMs / 1000}s...`);
        await sleep(err.waitMs);
        i--; // retry this case
        continue;
      }
      console.log(`❌ ${err.message || err}`);
      errors++;
    }

    await sleep(DELAY_MS);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Total B3 cases:    ${cases.rows.length}`);
  console.log(`  Transcribed:       ${ok}`);
  console.log(`  Errors:            ${errors}`);
  console.log(`\nDone! 🎉`);

  await pool.end();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
