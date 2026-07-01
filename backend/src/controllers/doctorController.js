const {dbHelpers} = require('../config/database');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs'); // Will need to run npm install bcryptjs

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_development_only';

// Hardcoded initial doctor for deployment ease. In production, registration should be managed via admin console.
async function ensureDefaultDoctor() {
  try {
    const existing = await dbHelpers.get('SELECT * FROM doctors WHERE username = $1', ['admin_doctor']);
    if (!existing) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash('nurseai2026', salt);
      await dbHelpers.run(
        'INSERT INTO doctors (username, password_hash, doctor_name) VALUES ($1, $2, $3)',
        ['admin_doctor', hash, 'Dr. Chief Medical Officer']
      );
      console.log('Created default doctor account (admin_doctor / nurseai2026)');
    }

    const existing2 = await dbHelpers.get('SELECT * FROM doctors WHERE username = $1', ['tripathiabhitesh@gmail.com']);
    if (!existing2) {
      const salt2 = await bcrypt.genSalt(10);
      const hash2 = await bcrypt.hash('NurseAI2026', salt2);
      await dbHelpers.run(
        'INSERT INTO doctors (username, password_hash, doctor_name) VALUES ($1, $2, $3)',
        ['tripathiabhitesh@gmail.com', hash2, 'Dr. Abhitesh Tripathi']
      );
      console.log('Created doctor account (tripathiabhitesh@gmail.com)');
    }

    const doctors = [
      { email: 'drchetanyamalik86@gmail.com', name: 'Dr. Chetanya Malik' },
      { email: 'drparul.icmr@gmail.com', name: 'Dr. Parul' },
    ];
    for (const doc of doctors) {
      const ex = await dbHelpers.get('SELECT * FROM doctors WHERE username = $1', [doc.email]);
      if (!ex) {
        const s = await bcrypt.genSalt(10);
        const h = await bcrypt.hash('NurseAI2026', s);
        await dbHelpers.run(
          'INSERT INTO doctors (username, password_hash, doctor_name) VALUES ($1, $2, $3)',
          [doc.email, h, doc.name]
        );
        console.log(`Created doctor account (${doc.email})`);
      }
    }
  } catch (err) {
    console.error('Failed to ensure default doctor:', err);
  }
}

// Ensure it runs once
ensureDefaultDoctor();

async function loginDoctor(req, res) {
  try {
    const {username, password} = req.body;

    if (!username || !password) {
      return res.status(400).json({success: false, error: 'Username and password required'});
    }

    const doctor = await dbHelpers.get('SELECT * FROM doctors WHERE username = $1', [username]);

    if (!doctor) {
      return res.status(401).json({success: false, error: 'Invalid credentials'});
    }

    const isValid = await bcrypt.compare(password, doctor.password_hash);
    if (!isValid) {
      return res.status(401).json({success: false, error: 'Invalid credentials'});
    }

    const token = jwt.sign({userId: doctor.id, role: 'doctor'}, JWT_SECRET, {expiresIn: '24h'});

    res.json({
      success: true,
      data: {
        token,
        doctor: {
          id: doctor.id,
          username: doctor.username,
          name: doctor.doctor_name,
        },
      },
    });
  } catch (error) {
    console.error('Doctor login error:', error);
    res.status(500).json({success: false, error: 'Internal server error'});
  }
}

async function getVisits(req, res) {
  try {
    // Get all completed gemini suggestions, group by verification status natively
    const query = `
      SELECT t.id, t.title, t.patient_name, t.patient_id, t.created_at, t.verification_status, 
             t.doctor_rating, t.doctor_remarks, t.verified_at, u.email AS nurse_email
      FROM transcripts t
      LEFT JOIN users u ON u.uid = t.user_uid
      WHERE t.source IN ('gemini', 'gemini-diagnosis') 
        AND t.suggestion_completed = true
      ORDER BY t.created_at DESC
    `;
    
    const transcripts = await dbHelpers.all(query, []);

    // Format for frontend grouping
    const result = {
      unverified: transcripts.filter(t => t.verification_status === 'unverified'),
      verified: transcripts.filter(t => t.verification_status === 'verified'),
      flagged: transcripts.filter(t => t.verification_status === 'flagged'),
    };

    res.json({success: true, data: result});
  } catch (error) {
    console.error('Get doctor visits error:', error);
    res.status(500).json({success: false, error: 'Internal server error'});
  }
}

async function verifyVisit(req, res) {
  try {
    const {id} = req.params;
    const {verdict, remarks} = req.body;

    if (!verdict || !['valid', 'invalid'].includes(verdict)) {
      return res.status(400).json({success: false, error: 'Verdict must be "valid" or "invalid"'});
    }

    const status = verdict === 'valid' ? 'verified' : 'flagged';
    // Store a numeric rating for backward compat: valid=10, invalid=1
    const rating = verdict === 'valid' ? 10 : 1;

    await dbHelpers.run(
      `UPDATE transcripts 
       SET verification_status = $1, doctor_rating = $2, doctor_remarks = $3, verified_at = CURRENT_TIMESTAMP
       WHERE id = $4`,
      [status, rating, remarks || null, id]
    );

    res.json({
      success: true, 
      data: {
        status, 
        verdict,
        remarks
      }
    });
  } catch (error) {
    console.error('Verify visit error:', error);
    res.status(500).json({success: false, error: 'Internal server error'});
  }
}

/**
 * Stream audio from Supabase storage — acts as a proxy to avoid CORS issues.
 * GET /api/doctor/audio/:audioRecordId
 */
async function streamAudio(req, res) {
  try {
    const {audioRecordId} = req.params;
    const audio = await dbHelpers.get('SELECT * FROM audio_records WHERE id = $1', [audioRecordId]);

    // Check bench_records table if not found in audio_records
    if (!audio) {
      const bmCase = await dbHelpers.get('SELECT * FROM bench_records WHERE id = $1', [audioRecordId]);
      if (bmCase) {
        const fs = require('fs');
        const path = require('path');

        // 1. Try exact local_path
        if (bmCase.local_path && fs.existsSync(bmCase.local_path)) {
          res.set('Content-Type', bmCase.mime_type || 'audio/mp4');
          return fs.createReadStream(bmCase.local_path).pipe(res);
        }

        // 2. Try relative path (handles Windows absolute paths on Linux)
        //    Try both the multer filename from local_path AND the original file_name
        const filenamesToTry = [];
        if (bmCase.local_path) {
          filenamesToTry.push(bmCase.local_path.replace(/\\/g, '/').split('/').pop());
        }
        if (bmCase.file_name) {
          filenamesToTry.push(bmCase.file_name);
        }
        for (const fn of filenamesToTry) {
          const candidates = [
            path.join(__dirname, '../../uploads/benchmark', fn),
            path.join(process.cwd(), 'uploads/benchmark', fn),
          ];
          for (const rp of candidates) {
            if (fs.existsSync(rp)) {
              res.set('Content-Type', bmCase.mime_type || 'audio/mp4');
              return fs.createReadStream(rp).pipe(res);
            }
          }
        }

        // 3. Try Supabase Storage
        const {createSignedAudioUrl, isStorageConfigured} = require('../services/supabaseStorage');
        if (isStorageConfigured()) {
          const storagePath = bmCase.local_path || bmCase.storage_path || `audio_records/${bmCase.id}/${bmCase.file_name}`;
          try {
            const signedUrl = await createSignedAudioUrl(storagePath, 600);
            if (signedUrl) {
              const upstream = await fetch(signedUrl);
              if (upstream.ok) {
                res.set('Content-Type', bmCase.mime_type || 'audio/mp4');
                const cl = upstream.headers.get('content-length');
                if (cl) res.set('Content-Length', cl);
                const nodeStream = require('stream');
                const readable = nodeStream.Readable.fromWeb(upstream.body);
                return readable.pipe(res);
              }
            }
          } catch (err) {
            console.error('Supabase bench audio stream error:', err.message);
          }
        }
      }
      return res.status(404).json({success: false, error: 'Audio not found'});
    }

    const {createSignedAudioUrl, isStorageConfigured} = require('../services/supabaseStorage');

    let storagePath = audio.storage_path;
    if (!storagePath && audio.id && audio.file_name) {
      storagePath = `audio_records/${audio.id}/${String(audio.file_name).replace(/\\/g, '/')}`;
    }

    // Try Supabase signed URL (production)
    if (storagePath && isStorageConfigured()) {
      try {
        const signedUrl = await createSignedAudioUrl(storagePath, 600);
        if (signedUrl) {
          const upstream = await fetch(signedUrl);
          if (upstream.ok) {
            res.set('Content-Type', audio.mime_type || 'audio/mp4');
            const cl = upstream.headers.get('content-length');
            if (cl) res.set('Content-Length', cl);
            const nodeStream = require('stream');
            const readable = nodeStream.Readable.fromWeb(upstream.body);
            return readable.pipe(res);
          }
        }
      } catch (err) {
        console.error('Supabase audio stream error:', err.message);
      }
    }

    // Fallback — try local file
    const fs = require('fs');
    if (audio.file_path && fs.existsSync(audio.file_path)) {
      res.set('Content-Type', audio.mime_type || 'audio/mp4');
      return fs.createReadStream(audio.file_path).pipe(res);
    }

    res.status(404).json({success: false, error: 'Audio file not accessible'});
  } catch (error) {
    console.error('Stream audio error:', error);
    res.status(500).json({success: false, error: 'Internal server error'});
  }
}

// ── Benchmarking Page: Frozen 50 Cases ─────────────────────────────────────────

/**
 * Ensure the frozen cases table exists and snapshot 50 latest IDs on first call.
 */
async function ensureFrozenCases() {
  await dbHelpers.run(`
    CREATE TABLE IF NOT EXISTS benchmarking_frozen_cases (
      audio_record_id UUID PRIMARY KEY REFERENCES audio_records(id) ON DELETE CASCADE,
      patient_name VARCHAR(255),
      patient_id VARCHAR(255),
      frozen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add columns if table already exists without them
  await dbHelpers.run(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'benchmarking_frozen_cases' AND column_name = 'patient_name') THEN
        ALTER TABLE benchmarking_frozen_cases ADD COLUMN patient_name VARCHAR(255);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'benchmarking_frozen_cases' AND column_name = 'patient_id') THEN
        ALTER TABLE benchmarking_frozen_cases ADD COLUMN patient_id VARCHAR(255);
      END IF;
    END $$;
  `);

  const count = await dbHelpers.get('SELECT COUNT(*) AS cnt FROM benchmarking_frozen_cases');
  if (parseInt(count?.cnt || 0) === 0) {
    const latest = await dbHelpers.all(
      'SELECT id, patient_name, patient_id FROM audio_records ORDER BY created_at DESC LIMIT 50'
    );
    for (const row of latest) {
      await dbHelpers.run(
        'INSERT INTO benchmarking_frozen_cases (audio_record_id, patient_name, patient_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [row.id, row.patient_name || null, row.patient_id || null]
      );
    }
  }
}

/**
 * GET /api/doctor/benchmarking/cases
 * Returns benchmark data cases uploaded via /benchmarkdata.
 * Supports Benchmark-1 (original 50) and Benchmark-2 (88 transcribed cases).
 */
async function getBenchmarkingCases(req, res) {
  try {
    const {ensureBenchTables} = require('./benchmarkDataController');
    await ensureBenchTables();

    const cases = await dbHelpers.all(`
      SELECT br.id, br.file_name, br.file_size, br.mime_type, br.local_path, br.created_at,
             bp.transcript, bp.prescription, bp.diagnosis, bp.proforma_text,
             bp.reasoning_steps, bp.reasoning_input, bp.reasoning_output,
             bp.model_used, bp.status,
             COALESCE(br.batch, 'benchmark-1') AS batch
      FROM bench_records br
      JOIN bench_pres bp ON bp.bench_record_id = br.id
      WHERE bp.status = 'completed'
      ORDER BY COALESCE(br.batch, 'benchmark-1') ASC, br.created_at ASC
    `);

    // Number each batch separately
    let b1Count = 0;
    let b2Count = 0;
    let b3Count = 0;
    const formatted = cases.map((c) => {
      const batch = c.batch || 'benchmark-1';
      let batchIndex, batchLabel;
      if (batch === 'benchmark-3') {
        batchIndex = ++b3Count;
        batchLabel = 'Benchmark-3';
      } else if (batch === 'benchmark-2') {
        batchIndex = ++b2Count;
        batchLabel = 'Benchmark-2';
      } else {
        batchIndex = ++b1Count;
        batchLabel = 'Benchmark-1';
      }

      return {
        id: c.id,
        patientName: `${batchLabel} — Case ${batchIndex}`,
        patientId: c.file_name || '',
        fileName: c.file_name,
        fileSize: c.file_size,
        mimeType: c.mime_type,
        createdAt: c.created_at,
        transcript: c.transcript || null,
        prescription: c.prescription || null,
        prescriptionId: null,
        diagnosis: c.diagnosis || null,
        reasoningSteps: c.reasoning_steps || null,
        reasoningInput: c.reasoning_input || null,
        reasoningOutput: c.reasoning_output || null,
        modelUsed: c.model_used || null,
        isBenchmarkData: true,
        proforma: c.proforma_text || null,
        batch: batch,
        batchIndex: batchIndex,
      };
    });

    res.json({success: true, data: formatted});
  } catch (error) {
    console.error('Get benchmarking cases error:', error);
    res.status(500).json({success: false, error: 'Internal server error'});
  }
}

/**
 * POST /api/doctor/benchmarking/transcribe/:audioId
 * Sends audio to Gemini for English transcription with speaker labels.
 */
async function transcribeAudio(req, res) {
  try {
    const {audioId} = req.params;
    let audio = await dbHelpers.get('SELECT * FROM audio_records WHERE id = $1', [audioId]);
    let isBenchmarkData = false;

    // Check bench_records table if not in audio_records
    if (!audio) {
      const bmCase = await dbHelpers.get('SELECT * FROM bench_records WHERE id = $1', [audioId]);
      if (!bmCase) return res.status(404).json({success: false, error: 'Audio not found'});
      audio = {id: bmCase.id, file_path: bmCase.local_path, mime_type: bmCase.mime_type, file_name: bmCase.file_name};
      isBenchmarkData = true;
    }

    const {createSignedAudioUrl, isStorageConfigured} = require('../services/supabaseStorage');
    const {transcribeAudioToEnglish} = require('../services/geminiService');

    // Get the audio data
    let audioBase64 = null;

    // Try Supabase first (production)
    let storagePath = audio.storage_path;
    if (!storagePath && audio.id && audio.file_name) {
      storagePath = `audio_records/${audio.id}/${String(audio.file_name).replace(/\\/g, '/')}`;
    }

    if (storagePath && isStorageConfigured()) {
      try {
        const signedUrl = await createSignedAudioUrl(storagePath, 600);
        if (signedUrl) {
          const upstream = await fetch(signedUrl);
          if (upstream.ok) {
            const buffer = Buffer.from(await upstream.arrayBuffer());
            audioBase64 = buffer.toString('base64');
          }
        }
      } catch (err) {
        console.error('Supabase fetch for transcription:', err.message);
      }
    }

    // Fallback to local file
    if (!audioBase64) {
      const fs = require('fs');
      if (audio.file_path && fs.existsSync(audio.file_path)) {
        audioBase64 = fs.readFileSync(audio.file_path, {encoding: 'base64'});
      }
    }

    if (!audioBase64) {
      return res.status(404).json({success: false, error: 'Audio file not accessible'});
    }

    const transcript = await transcribeAudioToEnglish({
      audioBase64,
      mimeType: audio.mime_type || 'audio/mp4',
    });

    res.json({success: true, data: {transcript}});
  } catch (error) {
    console.error('Transcribe audio error:', error);
    res.status(500).json({success: false, error: error.message || 'Transcription failed'});
  }
}

// ── Evaluations ────────────────────────────────────────────────────────────────

async function ensureEvaluationsTable() {
  await dbHelpers.run(`
    CREATE TABLE IF NOT EXISTS benchmarking_evaluations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      audio_record_id UUID NOT NULL,
      evaluator_id UUID NOT NULL,
      evaluator_name VARCHAR(255),
      criterion VARCHAR(50) NOT NULL,
      value VARCHAR(50) NOT NULL,
      comment TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(audio_record_id, evaluator_id, criterion)
    )
  `);
}

/**
 * POST /api/doctor/benchmarking/evaluate
 * Body: { audioRecordId, criterion, value, comment }
 * Upserts an evaluation for a specific case + user + criterion.
 */
async function saveEvaluation(req, res) {
  try {
    await ensureEvaluationsTable();
    const {audioRecordId, criterion, value, comment} = req.body || {};

    if (!audioRecordId || !criterion || !value) {
      return res.status(400).json({success: false, error: 'audioRecordId, criterion, and value are required.'});
    }

    const validCriteria = ['valid', 'appropriate', 'safe_severe', 'explainable'];
    if (!validCriteria.includes(criterion)) {
      return res.status(400).json({success: false, error: `Invalid criterion. Must be one of: ${validCriteria.join(', ')}`});
    }

    const evaluatorId = req.doctorId;
    const doctor = await dbHelpers.get('SELECT doctor_name, username FROM doctors WHERE id = $1', [evaluatorId]);
    const evaluatorName = doctor?.doctor_name || doctor?.username || 'Doctor';

    await dbHelpers.run(`
      INSERT INTO benchmarking_evaluations (audio_record_id, evaluator_id, evaluator_name, criterion, value, comment)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (audio_record_id, evaluator_id, criterion)
      DO UPDATE SET value = $5, comment = $6, updated_at = CURRENT_TIMESTAMP
    `, [audioRecordId, evaluatorId, evaluatorName, criterion, value, comment || null]);

    res.json({success: true});
  } catch (error) {
    console.error('Save evaluation error:', error);
    res.status(500).json({success: false, error: 'Internal server error'});
  }
}

/**
 * GET /api/doctor/benchmarking/evaluations/:audioRecordId
 * Returns all evaluations for a given case.
 */
async function getEvaluations(req, res) {
  try {
    await ensureEvaluationsTable();
    const {audioRecordId} = req.params;

    const rows = await dbHelpers.all(
      'SELECT criterion, value, comment, evaluator_name, evaluator_id, updated_at FROM benchmarking_evaluations WHERE audio_record_id = $1 AND evaluator_id = $2 ORDER BY criterion',
      [audioRecordId, req.doctorId]
    );

    res.json({success: true, data: rows});
  } catch (error) {
    console.error('Get evaluations error:', error);
    res.status(500).json({success: false, error: 'Internal server error'});
  }
}

/**
 * POST /api/doctor/benchmarking/submit
 * Body: { audioRecordId }
 * Validates all 4 criteria are evaluated, then marks case as completed.
 */
async function submitEvaluation(req, res) {
  try {
    await ensureEvaluationsTable();
    await dbHelpers.run(`
      CREATE TABLE IF NOT EXISTS benchmarking_completed (
        audio_record_id UUID NOT NULL,
        evaluator_id UUID NOT NULL,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (audio_record_id, evaluator_id)
      )
    `);

    const {audioRecordId, evaluations} = req.body || {};
    if (!audioRecordId) return res.status(400).json({success: false, error: 'audioRecordId required'});

    const evaluatorId = req.doctorId;
    const doctor = await dbHelpers.get('SELECT doctor_name, username FROM doctors WHERE id = $1', [evaluatorId]);
    const evaluatorName = doctor?.doctor_name || doctor?.username || 'Doctor';

    // Validate all required criteria are present
    const required = ['valid', 'appropriate', 'safe_severe', 'explainable'];
    if (!evaluations || !Array.isArray(evaluations)) {
      return res.status(400).json({success: false, error: 'evaluations array required'});
    }
    const provided = new Set(evaluations.map(e => e.criterion));
    const missing = required.filter(c => !provided.has(c));
    if (missing.length > 0) {
      return res.status(400).json({success: false, error: `Missing evaluations: ${missing.join(', ')}`});
    }

    // Save all evaluations at once
    for (const ev of evaluations) {
      if (!required.includes(ev.criterion)) continue;
      await dbHelpers.run(`
        INSERT INTO benchmarking_evaluations (audio_record_id, evaluator_id, evaluator_name, criterion, value, comment)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (audio_record_id, evaluator_id, criterion)
        DO UPDATE SET value = $5, comment = $6, updated_at = CURRENT_TIMESTAMP
      `, [audioRecordId, evaluatorId, evaluatorName, ev.criterion, ev.value, ev.comment || null]);
    }

    // Mark as completed
    await dbHelpers.run(
      'INSERT INTO benchmarking_completed (audio_record_id, evaluator_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [audioRecordId, evaluatorId]
    );

    res.json({success: true});
  } catch (error) {
    console.error('Submit evaluation error:', error.message, error.detail || '', error.stack?.substring(0, 300));
    res.status(500).json({success: false, error: error.message || 'Internal server error'});
  }
}

/**
 * GET /api/doctor/benchmarking/completed
 * Returns list of completed case IDs for the current doctor.
 */
async function getCompletedCases(req, res) {
  try {
    await dbHelpers.run(`
      CREATE TABLE IF NOT EXISTS benchmarking_completed (
        audio_record_id UUID NOT NULL,
        evaluator_id UUID NOT NULL,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (audio_record_id, evaluator_id)
      )
    `);

    const rows = await dbHelpers.all(
      'SELECT audio_record_id FROM benchmarking_completed WHERE evaluator_id = $1',
      [req.doctorId]
    );

    res.json({success: true, data: rows.map(r => r.audio_record_id)});
  } catch (error) {
    console.error('Get completed cases error:', error);
    res.status(500).json({success: false, error: 'Internal server error'});
  }
}

module.exports = {
  loginDoctor,
  getVisits,
  verifyVisit,
  streamAudio,
  getBenchmarkingCases,
  transcribeAudio,
  saveEvaluation,
  getEvaluations,
  submitEvaluation,
  getCompletedCases,
};

