/**
 * Upload benchmark audio files to Supabase Storage
 * Run: node upload-bench-audio-to-supabase.js
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const {createClient} = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://paxdkwuewfwntpmooddf.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'audio';

if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {persistSession: false},
});

const {dbHelpers} = require('./src/config/database');

async function main() {
  // Ensure storage_path column exists
  await dbHelpers.run(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='bench_records' AND column_name='storage_path') THEN
        ALTER TABLE bench_records ADD COLUMN storage_path TEXT;
      END IF;
    END $$;
  `);

  console.log('📂 Fetching bench_records from DB...');
  const records = await dbHelpers.all('SELECT id, file_name, local_path, mime_type FROM bench_records');
  console.log(`Found ${records.length} bench_records\n`);

  const benchDir = path.join(__dirname, 'uploads', 'benchmark');
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const rec of records) {
    const storagePath = `audio_records/${rec.id}/${rec.file_name}`;

    // Check if already uploaded
    const {data: existing} = await supabase.storage.from(BUCKET).list(`audio_records/${rec.id}`);
    if (existing && existing.length > 0) {
      console.log(`⏭️  ${rec.file_name} — already in Supabase, skipping`);
      skipped++;
      // Still update storage_path in DB
      await dbHelpers.run(
        'UPDATE bench_records SET storage_path = $1 WHERE id = $2',
        [storagePath, rec.id]
      );
      continue;
    }

    // Find local file — try exact path, then by multer name, then by original name
    let filePath = null;
    const candidates = [];

    // 1. Exact local_path
    if (rec.local_path) candidates.push(rec.local_path);

    // 2. Multer filename from local_path
    if (rec.local_path) {
      const multerName = rec.local_path.replace(/\\/g, '/').split('/').pop();
      candidates.push(path.join(benchDir, multerName));
    }

    // 3. Original file_name
    if (rec.file_name) {
      candidates.push(path.join(benchDir, rec.file_name));
    }

    for (const c of candidates) {
      if (fs.existsSync(c)) {
        filePath = c;
        break;
      }
    }

    if (!filePath) {
      console.error(`❌ ${rec.file_name} (${rec.id}) — file not found locally`);
      failed++;
      continue;
    }

    // Upload to Supabase
    const buffer = fs.readFileSync(filePath);
    const mimeType = rec.mime_type || 'audio/mpeg';

    console.log(`⬆️  Uploading ${rec.file_name} (${(buffer.length / 1024 / 1024).toFixed(1)}MB) → ${storagePath}`);

    const {error: uploadError} = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      console.error(`❌ Upload failed for ${rec.file_name}: ${uploadError.message}`);
      failed++;
      continue;
    }

    // Update DB with storage_path
    await dbHelpers.run(
      'UPDATE bench_records SET storage_path = $1 WHERE id = $2',
      [storagePath, rec.id]
    );

    console.log(`✅ ${rec.file_name} uploaded successfully`);
    uploaded++;
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Done! Uploaded: ${uploaded} | Skipped: ${skipped} | Failed: ${failed}`);
  console.log(`Total: ${records.length}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
