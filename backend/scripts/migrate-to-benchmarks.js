#!/usr/bin/env node
/**
 * Migrate 88 transcribed audio_records → bench_records + bench_pres
 * for Benchmark-2 on the doctor benchmarking page.
 *
 * Data mapping:
 *   audio_records.full_audio_transcript  →  bench_pres.transcript
 *   transcripts (source='gemini')         →  bench_pres.prescription
 *   transcripts (source='gemini-diagnosis') → bench_pres.reasoning_output (clarifying Qs)
 *   ai_reasoning_log                      →  bench_pres.reasoning_steps/input/output
 *
 * Usage:
 *   node scripts/migrate-to-benchmarks.js --db-url "postgresql://..."
 *   node scripts/migrate-to-benchmarks.js --dry-run
 */

const { Pool } = require('pg');

const args = process.argv.slice(2);
function getArg(n) { const i = args.indexOf(n); return i !== -1 && args[i+1] ? args[i+1] : null; }
const DRY_RUN = args.includes('--dry-run');
const DB_URL = getArg('--db-url');

function buildPool() {
  const url = DB_URL || process.env.DATABASE_URL;
  if (url) return new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return new Pool({ host: 'localhost', port: 5432, database: 'nurseai', user: 'postgres', password: '' });
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Migrate audio_records → Benchmark-2');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN' : '🚀 LIVE'}\n`);

  const pool = buildPool();
  await pool.query('SELECT 1');
  console.log('✅ Connected to DB\n');

  // Ensure batch column exists on bench_records
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bench_records' AND column_name='batch') THEN
        ALTER TABLE bench_records ADD COLUMN batch VARCHAR(50) DEFAULT 'benchmark-1';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bench_records' AND column_name='source_audio_record_id') THEN
        ALTER TABLE bench_records ADD COLUMN source_audio_record_id UUID;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bench_pres' AND column_name='diagnosis') THEN
        ALTER TABLE bench_pres ADD COLUMN diagnosis TEXT;
      END IF;
    END $$;
  `);

  // Mark existing records as benchmark-1 (if not already set)
  await pool.query(`UPDATE bench_records SET batch = 'benchmark-1' WHERE batch IS NULL`);
  console.log('✅ DB schema updated\n');

  // Get the 88 completed transcription cases
  const { rows: audioCases } = await pool.query(`
    SELECT id, patient_id, patient_name, file_name, file_size, mime_type, file_url,
           storage_path, full_audio_transcript, created_at
    FROM audio_records
    WHERE transcript_status = 'completed'
    ORDER BY created_at ASC
  `);
  console.log(`📋 Found ${audioCases.length} completed transcription cases\n`);

  // Check which are already migrated
  const { rows: existing } = await pool.query(
    `SELECT source_audio_record_id FROM bench_records WHERE batch = 'benchmark-2' AND source_audio_record_id IS NOT NULL`
  );
  const alreadyMigrated = new Set(existing.map(r => r.source_audio_record_id));

  const stats = { migrated: 0, skipped: 0, noDiagnosis: 0, noPrescription: 0, errors: 0 };

  for (let i = 0; i < audioCases.length; i++) {
    const ar = audioCases[i];
    const progress = `[${i + 1}/${audioCases.length}]`;
    process.stdout.write(`  ${progress} ${ar.patient_id}...`);

    // Skip if already migrated
    if (alreadyMigrated.has(ar.id)) {
      console.log(' ⏭️  Already migrated');
      stats.skipped++;
      continue;
    }

    // Fetch diagnosis (clarifying questions) from transcripts
    const { rows: diagRows } = await pool.query(
      `SELECT content FROM transcripts
       WHERE audio_record_id = $1 AND source = 'gemini-diagnosis'
       ORDER BY created_at DESC LIMIT 1`,
      [ar.id]
    );
    const diagnosisText = diagRows[0]?.content || null;

    // Fetch prescription from transcripts
    const { rows: rxRows } = await pool.query(
      `SELECT content FROM transcripts
       WHERE audio_record_id = $1 AND source = 'gemini'
       ORDER BY created_at DESC LIMIT 1`,
      [ar.id]
    );
    const prescriptionText = rxRows[0]?.content || null;

    // Fetch reasoning from ai_reasoning_log
    const { rows: reasoningRows } = await pool.query(
      `SELECT stage, input_summary, reasoning_steps, output_summary, model_used
       FROM ai_reasoning_log
       WHERE audio_record_id = $1
       ORDER BY created_at DESC LIMIT 2`,
      [ar.id]
    );
    // Get prescription reasoning if available, else diagnosis reasoning
    const prescriptionReasoning = reasoningRows.find(r => r.stage === 'prescription');
    const diagnosisReasoning = reasoningRows.find(r => r.stage === 'diagnosis');
    const reasoning = prescriptionReasoning || diagnosisReasoning || null;

    if (!diagnosisText) {
      stats.noDiagnosis++;
    }

    if (!prescriptionText) {
      stats.noPrescription++;
    }

    if (DRY_RUN) {
      const hasRx = prescriptionText ? '✓ Rx' : '✗ No Rx';
      const hasReasoning = reasoning ? '✓ Reasoning' : '✗ No Reasoning';
      console.log(` ✅ WOULD MIGRATE (${hasRx}, ${hasReasoning})`);
      stats.migrated++;
      continue;
    }

    try {
      // INSERT into bench_records
      const { rows: [newBr] } = await pool.query(
        `INSERT INTO bench_records (id, file_name, file_size, mime_type, storage_path, created_at, batch, source_audio_record_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'benchmark-2', $6)
         RETURNING id`,
        [ar.file_name, ar.file_size, ar.mime_type, ar.storage_path, ar.created_at, ar.id]
      );

      // INSERT into bench_pres — reasoning_steps is JSONB, ensure proper format
      let reasoningJson = null;
      if (reasoning?.reasoning_steps) {
        try {
          // If it's already a string, parse to validate then re-stringify
          const parsed = typeof reasoning.reasoning_steps === 'string'
            ? JSON.parse(reasoning.reasoning_steps)
            : reasoning.reasoning_steps;
          reasoningJson = JSON.stringify(parsed);
        } catch (e) {
          reasoningJson = null; // Skip invalid JSON
        }
      }

      await pool.query(
        `INSERT INTO bench_pres
          (id, bench_record_id, transcript, prescription, diagnosis,
           reasoning_steps, reasoning_input, reasoning_output,
           model_used, status, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5::jsonb, $6, $7, $8, 'completed', NOW())`,
        [
          newBr.id,
          ar.full_audio_transcript || null,
          prescriptionText || null,
          diagnosisText || null,
          reasoningJson,
          reasoning?.input_summary || null,
          reasoning?.output_summary || null,
          reasoning?.model_used || 'gemini-2.5-flash',
        ]
      );

      console.log(` ✅ Migrated (bench_record: ${newBr.id.substring(0, 8)}...)`);
      stats.migrated++;

    } catch (err) {
      console.log(` ❌ Error: ${err.message}`);
      stats.errors++;
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Total cases:              ${audioCases.length}`);
  console.log(`  Migrated:                  ${stats.migrated}`);
  console.log(`  Skipped (already done):    ${stats.skipped}`);
  console.log(`  No clarifying Qs (skip):   ${stats.noDiagnosis}`);
  console.log(`  No prescription:           ${stats.noPrescription}`);
  console.log(`  Errors:                    ${stats.errors}`);

  await pool.end();
  console.log('\nDone! 🎉');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
