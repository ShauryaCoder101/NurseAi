const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

// ─── Configuration ──────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://paxdkwuewfwntpmooddf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'audio';

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(name);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const INPUT_DIR = getArg('--input');
const DB_URL_OVERRIDE = getArg('--db-url');

if (!INPUT_DIR) {
  console.error('❌ Missing --input <path>. Provide the path to the extracted GDrive folder.');
  console.error('   Example: node scripts/gdrive-audio-sync.js --input "C:\\Users\\Shaurya\\Desktop\\GDrive_Audios"');
  process.exit(1);
}

if (!fs.existsSync(INPUT_DIR)) {
  console.error(`❌ Input directory not found: ${INPUT_DIR}`);
  process.exit(1);
}

// ─── Database Setup ─────────────────────────────────────────────────────────
function buildPool() {
  const dbUrl = DB_URL_OVERRIDE || process.env.DATABASE_URL;
  if (dbUrl) {
    return new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    });
  }

  // Fallback to individual env vars
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'nurseai',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });
}

// ─── Supabase Upload (using SDK, same as supabaseStorage.js) ────────────────
let supabaseClient = null;
function getSupabaseClient() {
  if (!supabaseClient && SUPABASE_URL && SUPABASE_KEY) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });
  }
  return supabaseClient;
}

async function uploadToSupabase(filePath, storagePath) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Supabase client not configured');

  const fileBuffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.aac': 'audio/aac',
    '.mp4': 'audio/mp4',
    '.webm': 'audio/webm',
  };
  const mimeType = mimeMap[ext] || 'audio/mpeg';

  const { error: uploadError } = await client.storage
    .from(SUPABASE_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: mimeType,
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Supabase upload failed: ${uploadError.message}`);
  }

  const { data: publicData } = client.storage
    .from(SUPABASE_BUCKET)
    .getPublicUrl(storagePath);

  return { publicUrl: publicData?.publicUrl || null, mimeType };
}

// ─── Scan Google Drive Folder ───────────────────────────────────────────────
function scanDriveFolder(inputDir) {
  const results = [];

  // Auto-detect nested folder (e.g., full_audios/RawData_Birbhum/)
  let scanDir = inputDir;
  const subEntries = fs.readdirSync(inputDir, { withFileTypes: true });
  const subDirs = subEntries.filter(e => e.isDirectory());
  // If there's only one subfolder and no patient folders at this level, go deeper
  if (subDirs.length === 1 && !subDirs[0].name.match(/^(BRS|BRD)\d+$/i)) {
    scanDir = path.join(inputDir, subDirs[0].name);
    console.log(`   📂 Auto-detected nested folder: ${subDirs[0].name}`);
  }

  const entries = fs.readdirSync(scanDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const folderName = entry.name.trim();
    const folderPath = path.join(scanDir, folderName);

    // Extract patient ID from folder name
    // Supports: BRS5001, BRD1001, NUR-BRS5001, etc.
    const patientIdMatch = folderName.match(/(?:NUR-?)?((BRS|BRD)\d+)/i);
    if (!patientIdMatch) {
      if (VERBOSE) console.warn(`⚠️  Skipping folder "${folderName}" — no patient ID pattern found`);
      continue;
    }
    const patientId = patientIdMatch[1].toUpperCase();

    // Find audio files in this folder
    const files = fs.readdirSync(folderPath, { withFileTypes: true });
    const audioFiles = files
      .filter(f => f.isFile() && /\.(mp3|m4a|wav|ogg|aac|mp4|webm)$/i.test(f.name))
      .map(f => ({
        name: f.name,
        path: path.join(folderPath, f.name),
        size: fs.statSync(path.join(folderPath, f.name)).size,
        isNurse: /^NUR-/i.test(f.name),
        isDoctor: /^DR-/i.test(f.name),
      }))
      .sort((a, b) => b.size - a.size); // Largest first

    if (audioFiles.length === 0) {
      console.warn(`⚠️  Skipping folder "${folderName}" — no audio files found`);
      continue;
    }

    // Pick the NUR- prefixed file first, fallback to largest
    let nurseAudio = audioFiles.find(f => f.isNurse);
    if (!nurseAudio) {
      // No NUR- prefix found — pick largest non-doctor file
      nurseAudio = audioFiles.find(f => !f.isDoctor) || audioFiles[0];
      if (VERBOSE) console.log(`   ⚠️  ${folderName}: No NUR- file found, using "${nurseAudio.name}" (largest)`);
    }

    if (VERBOSE && audioFiles.length > 1) {
      const otherFile = audioFiles.find(f => f !== nurseAudio);
      if (otherFile) {
        console.log(`   📁 ${folderName}: NUR="${nurseAudio.name}" (${(nurseAudio.size / 1024 / 1024).toFixed(1)}MB), DR="${otherFile.name}" (${(otherFile.size / 1024 / 1024).toFixed(1)}MB)`);
      }
    }

    results.push({
      patientId,
      folderName,
      audioFile: nurseAudio,
    });
  }

  return results;
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  NurseAI — Google Drive Audio Sync');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Input:    ${INPUT_DIR}`);
  console.log(`  Mode:     ${DRY_RUN ? '🔍 DRY RUN (no changes)' : '🚀 LIVE (will modify DB + Supabase)'}`);
  console.log('');

  // Step 1: Scan input folder
  console.log('📂 Scanning Google Drive folder...');
  const driveFiles = scanDriveFolder(INPUT_DIR);
  console.log(`   Found ${driveFiles.length} patient folders with audio files\n`);

  if (driveFiles.length === 0) {
    console.log('Nothing to process. Exiting.');
    process.exit(0);
  }

  // Step 2: Connect to DB
  const pool = buildPool();
  let client;
  try {
    client = await pool.connect();
    console.log('✅ Connected to database\n');
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('   Set DATABASE_URL or DB_HOST/DB_NAME/DB_USER/DB_PASSWORD env vars');
    process.exit(1);
  }

  // Step 3: Check Supabase
  if (!SUPABASE_KEY) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set. Cannot upload files.');
    if (!DRY_RUN) process.exit(1);
  }

  // Step 4: Process each patient
  const stats = { matched: 0, uploaded: 0, skipped: 0, errors: 0, notFound: 0 };
  const report = [];

  for (const item of driveFiles) {
    const { patientId, folderName, audioFile } = item;
    process.stdout.write(`  Processing ${patientId}...`);

    try {
      // Find matching audio_record in DB
      // Try multiple patient_id formats: BRS5001, NUR-BRS5001
      const dbRecord = await client.query(
        `SELECT ar.id, ar.file_name, ar.file_url, ar.storage_path, ar.file_size, ar.patient_id, ar.patient_name, ar.user_uid
         FROM audio_records ar
         WHERE UPPER(ar.patient_id) IN ($1, $2, $3, $4)
         ORDER BY ar.created_at DESC
         LIMIT 1`,
        [patientId, `NUR-${patientId}`, patientId.toLowerCase(), `NUR-${patientId}`.toLowerCase()]
      );

      if (dbRecord.rows.length === 0) {
        console.log(` ⚠️  No DB record found`);
        stats.notFound++;
        report.push({ patientId, status: 'NOT_FOUND', reason: 'No audio_record in DB' });
        continue;
      }

      const record = dbRecord.rows[0];
      stats.matched++;

      const sizeMB = (audioFile.size / 1024 / 1024).toFixed(1);
      const oldSizeMB = record.file_size ? (record.file_size / 1024 / 1024).toFixed(1) : '?';

      // Skip if DB already has the full audio (size is ≥90% of GDrive file)
      // This means it was already synced in a previous run
      if (record.file_size && record.file_size >= audioFile.size * 0.9) {
        console.log(` ⏭️  SKIPPED — full audio already exists (${oldSizeMB}MB in DB, ${sizeMB}MB in GDrive)`);
        stats.skipped++;
        report.push({
          patientId,
          status: 'SKIPPED',
          reason: 'Full audio already exists in DB',
          recordId: record.id,
          dbSize: record.file_size,
          driveSize: audioFile.size,
        });
        continue;
      }

      if (DRY_RUN) {
        console.log(` ✅ MATCH → record ${record.id.substring(0, 8)}... (${oldSizeMB}MB → ${sizeMB}MB)`);
        report.push({
          patientId,
          status: 'WOULD_REPLACE',
          recordId: record.id,
          oldSize: record.file_size,
          newSize: audioFile.size,
          fileName: audioFile.name,
        });
        continue;
      }

      // Upload to Supabase
      const storagePath = `audio_records/${record.id}/${audioFile.name}`;
      const { publicUrl, mimeType } = await uploadToSupabase(audioFile.path, storagePath);

      // Update DB record
      await client.query(
        `UPDATE audio_records
         SET file_url = $1,
             storage_path = $2,
             file_size = $3,
             mime_type = $4,
             file_name = $5
         WHERE id = $6`,
        [publicUrl, storagePath, audioFile.size, mimeType, audioFile.name, record.id]
      );

      console.log(` ✅ Uploaded (${oldSizeMB}MB → ${sizeMB}MB)`);
      stats.uploaded++;
      report.push({
        patientId,
        status: 'REPLACED',
        recordId: record.id,
        oldSize: record.file_size,
        newSize: audioFile.size,
        supabaseUrl: publicUrl,
      });
    } catch (err) {
      console.log(` ❌ Error: ${err.message}`);
      stats.errors++;
      report.push({ patientId, status: 'ERROR', error: err.message });
    }
  }

  // Step 5: Summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  SUMMARY');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Total patient folders scanned:  ${driveFiles.length}`);
  console.log(`  Matched to DB records:          ${stats.matched}`);
  console.log(`  Successfully uploaded:           ${stats.uploaded}`);
  console.log(`  Not found in DB:                ${stats.notFound}`);
  console.log(`  Errors:                         ${stats.errors}`);
  console.log('');

  // Save report
  const reportPath = path.join(__dirname, `sync-report-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`  📋 Full report saved to: ${reportPath}`);

  // Show not-found patients
  const notFoundList = report.filter(r => r.status === 'NOT_FOUND');
  if (notFoundList.length > 0) {
    console.log(`\n  ⚠️  Patients NOT found in DB:`);
    notFoundList.forEach(r => console.log(`     - ${r.patientId}`));
  }

  // Show errors
  const errorList = report.filter(r => r.status === 'ERROR');
  if (errorList.length > 0) {
    console.log(`\n  ❌ Errors:`);
    errorList.forEach(r => console.log(`     - ${r.patientId}: ${r.error}`));
  }

  client.release();
  await pool.end();
  console.log('\nDone! 🎉');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
