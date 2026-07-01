const path = require('path');
const fs = require('fs');
const multer = require('multer');
const {dbHelpers} = require('../config/database');
const {generateBenchmarkPrescription, transcribeAudioToEnglish} = require('../services/geminiService');
const {uploadAudioFile, isStorageConfigured} = require('../services/supabaseStorage');

// Multer setup for benchmark audio uploads
const uploadDir = path.join(__dirname, '../../uploads/benchmark');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, {recursive: true});

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, unique + path.extname(file.originalname));
  },
});
const upload = multer({storage, limits: {fileSize: 100 * 1024 * 1024}});

let _benchTablesReady = false;
async function ensureBenchTables() {
  if (_benchTablesReady) return;
  await dbHelpers.run(`
    CREATE TABLE IF NOT EXISTS bench_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      file_name VARCHAR(255),
      file_size BIGINT,
      mime_type VARCHAR(100),
      local_path TEXT,
      storage_path TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await dbHelpers.run(`
    CREATE TABLE IF NOT EXISTS bench_pres (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      bench_record_id UUID NOT NULL REFERENCES bench_records(id) ON DELETE CASCADE,
      transcript TEXT,
      prescription TEXT,
      reasoning_steps JSONB,
      reasoning_input TEXT,
      reasoning_output TEXT,
      model_used VARCHAR(100),
      status VARCHAR(20) DEFAULT 'pending',
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Add columns that may be missing on existing tables
  const addCol = async (table, col, type) => {
    await dbHelpers.run(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${table}' AND column_name='${col}') THEN
          ALTER TABLE ${table} ADD COLUMN ${col} ${type};
        END IF;
      END $$;
    `);
  };
  await addCol('bench_pres', 'transcript', 'TEXT');
  await addCol('bench_pres', 'model_used', 'VARCHAR(100)');
  await addCol('bench_pres', 'reasoning_steps', 'JSONB');
  await addCol('bench_pres', 'reasoning_input', 'TEXT');
  await addCol('bench_pres', 'reasoning_output', 'TEXT');
  await addCol('bench_pres', 'prescription_gem31pro', 'TEXT');
  await addCol('bench_records', 'storage_path', 'TEXT');
  _benchTablesReady = true;
}

/**
 * POST /api/benchmarkdata/upload
 * Accepts up to 50 audio files. APPENDS to existing cases.
 */
async function uploadBenchmarkData(req, res) {
  try {
    await ensureBenchTables();

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({success: false, error: 'No audio files provided'});
    }

    // Insert new records (APPEND — no deletion of old data)
    const caseIds = [];
    for (const file of req.files) {
      const record = await dbHelpers.get(`
        INSERT INTO bench_records (file_name, file_size, mime_type, local_path)
        VALUES ($1, $2, $3, $4)
        RETURNING id
      `, [file.originalname, file.size, file.mimetype, file.path]);

      // Upload to Supabase Storage so files are accessible on EB deployment
      if (isStorageConfigured()) {
        try {
          const uploaded = await uploadAudioFile({
            filePath: file.path,
            fileName: file.originalname,
            recordId: record.id,
            mimeType: file.mimetype,
          });
          if (uploaded) {
            await dbHelpers.run(
              'UPDATE bench_records SET storage_path = $1 WHERE id = $2',
              [uploaded.storagePath, record.id]
            );
            console.log(`☁️ Bench ${record.id}: uploaded to Supabase → ${uploaded.storagePath}`);
          }
        } catch (uploadErr) {
          console.error(`⚠️ Bench ${record.id}: Supabase upload failed (non-fatal):`, uploadErr.message);
        }
      }

      // Create pending prescription entry
      await dbHelpers.run(`
        INSERT INTO bench_pres (bench_record_id, status) VALUES ($1, 'pending')
      `, [record.id]);

      caseIds.push({id: record.id, file});
    }

    // Respond immediately
    res.json({
      success: true,
      message: `${req.files.length} files uploaded. Processing with AI...`,
      caseIds: caseIds.map(c => c.id),
      total: req.files.length,
    });

    // Process in background
    processFilesInBackground(caseIds);

  } catch (error) {
    console.error('Benchmark upload error:', error);
    res.status(500).json({success: false, error: error.message});
  }
}

async function processFilesInBackground(caseIds) {
  for (const {id, file} of caseIds) {
    try {
      const audioBuffer = fs.readFileSync(file.path);
      const audioBase64 = audioBuffer.toString('base64');
      const mimeType = file.mimetype || 'audio/mp4';

      // Step 1: Generate English transcript
      console.log(`Bench case ${id}: generating transcript...`);
      let transcript = '';
      try {
        transcript = await transcribeAudioToEnglish({ audioBase64, mimeType });
      } catch (e) {
        console.error(`Bench case ${id} transcript failed:`, e.message);
        transcript = '[Transcript generation failed]';
      }

      // Step 2: Generate prescription + reasoning
      console.log(`Bench case ${id}: generating prescription...`);
      const result = await generateBenchmarkPrescription({ audioBase64, mimeType });

      // Parse reasoning
      const reasoning = result.reasoning || null;
      const reasoningSteps = reasoning?.steps ? JSON.stringify(reasoning) : null;
      const reasoningInput = reasoning?.input_summary || null;
      const reasoningOutput = reasoning?.output_summary || null;

      await dbHelpers.run(`
        UPDATE bench_pres SET
          transcript = $1, prescription = $2, reasoning_steps = $3, reasoning_input = $4,
          reasoning_output = $5, model_used = $6, status = 'completed'
        WHERE bench_record_id = $7
      `, [transcript, result.text, reasoningSteps, reasoningInput, reasoningOutput, result.modelUsed, id]);

      console.log(`Bench case ${id} processed OK (${file.originalname})`);
    } catch (err) {
      console.error(`Bench case ${id} failed:`, err.message);
      await dbHelpers.run(
        `UPDATE bench_pres SET status = 'error', error_message = $1 WHERE bench_record_id = $2`,
        [err.message, id]
      );
    }
  }
  console.log(`Benchmark processing complete: ${caseIds.length} files`);
}

/**
 * GET /api/benchmarkdata/status
 */
async function getBenchmarkStatus(req, res) {
  try {
    await ensureBenchTables();
    const cases = await dbHelpers.all(`
      SELECT br.id, br.file_name, bp.status, bp.error_message, br.created_at
      FROM bench_records br
      JOIN bench_pres bp ON bp.bench_record_id = br.id
      ORDER BY br.created_at ASC
    `);
    const total = cases.length;
    const completed = cases.filter(c => c.status === 'completed').length;
    const pending = cases.filter(c => c.status === 'pending').length;
    const errors = cases.filter(c => c.status === 'error').length;

    res.json({success: true, data: {total, completed, pending, errors, cases}});
  } catch (error) {
    res.status(500).json({success: false, error: error.message});
  }
}

module.exports = {upload, uploadBenchmarkData, getBenchmarkStatus, ensureBenchTables};
