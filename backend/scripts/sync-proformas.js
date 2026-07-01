#!/usr/bin/env node
/**
 * Sync proforma_text from audio_records → bench_pres for Benchmark-2 cases.
 * Uses bench_records.source_audio_record_id to link back to audio_records.
 */

const { Pool } = require('pg');

const args = process.argv.slice(2);
function getArg(n) { const i = args.indexOf(n); return i !== -1 && args[i+1] ? args[i+1] : null; }
const DB_URL = getArg('--db-url');

function buildPool() {
  const url = DB_URL || process.env.DATABASE_URL;
  if (url) return new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  return new Pool({ host: 'localhost', port: 5432, database: 'nurseai', user: 'postgres', password: '' });
}

async function main() {
  console.log('Syncing proformas: audio_records → bench_pres\n');
  const pool = buildPool();

  // Add proforma_text column to bench_pres if not exists
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bench_pres' AND column_name='proforma_text') THEN
        ALTER TABLE bench_pres ADD COLUMN proforma_text TEXT;
      END IF;
    END $$;
  `);

  // Update bench_pres with proforma from audio_records
  const result = await pool.query(`
    UPDATE bench_pres bp
    SET proforma_text = ar.proforma_text
    FROM bench_records br
    JOIN audio_records ar ON ar.id = br.source_audio_record_id
    WHERE bp.bench_record_id = br.id
      AND br.batch = 'benchmark-2'
      AND ar.proforma_text IS NOT NULL
      AND ar.proforma_status = 'completed'
      AND (bp.proforma_text IS NULL OR bp.proforma_text = '')
  `);

  console.log(`✅ Updated ${result.rowCount} bench_pres records with proforma_text`);

  // Check stats
  const stats = await pool.query(`
    SELECT 
      COUNT(*) as total,
      COUNT(bp.proforma_text) as with_proforma
    FROM bench_records br
    JOIN bench_pres bp ON bp.bench_record_id = br.id
    WHERE br.batch = 'benchmark-2'
  `);
  console.log(`   Total B2 cases: ${stats.rows[0].total}`);
  console.log(`   With proforma:  ${stats.rows[0].with_proforma}`);

  await pool.end();
  console.log('\nDone! 🎉');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
