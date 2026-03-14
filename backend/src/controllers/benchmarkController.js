const fs = require('fs');
const path = require('path');
const {v4: uuidv4} = require('uuid');
const {dbHelpers} = require('../config/database');
const {generateBenchmarkAudio, getBenchmarkPrompt} = require('../services/geminiService');
const {
  createSignedAudioUrl,
  isStorageConfigured,
  uploadAudioFile,
} = require('../services/supabaseStorage');

const MODEL_DEFINITIONS = [
  {
    id: 'gemini-3',
    label: 'Gemini 3',
    envKey: 'GEMINI_3_MODEL',
    defaultModel: 'gemini-3',
  },
  {
    id: 'gemini-3-fast',
    label: 'Gemini 3 Fast',
    envKey: 'GEMINI_3_FAST_MODEL',
    defaultModel: 'gemini-3-fast',
  },
  {
    id: 'med-gemma-1.5-4b',
    label: 'Med Gemma 1.5-4B',
    envKey: 'MED_GEMMA_1_5_4B_MODEL',
    defaultModel: 'med-gemma-1.5-4b',
  },
];

const RUN_TTL_MS = 30 * 60 * 1000;
const runStore = new Map();

const pruneRuns = () => {
  const now = Date.now();
  for (const [key, value] of runStore.entries()) {
    if (now - value.createdAt > RUN_TTL_MS) {
      runStore.delete(key);
    }
  }
};

const shuffle = (items) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

async function getBenchmarkSuggestions(req, res) {
  try {
    const {limit = '50', includeCompleted = 'false'} = req.query;
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);

    let query =
      `SELECT ar.*, fs.id AS flagged_id
       FROM audio_records ar
       LEFT JOIN flagged_suggestions fs
         ON fs.audio_record_id = ar.id
       WHERE 1 = 1`;
    const params = [];

    if (includeCompleted !== 'true') {
      query += ' AND ar.id IS NOT NULL';
    }

    query += ' ORDER BY ar.created_at DESC LIMIT $1';
    params.push(parsedLimit);

    const records = await dbHelpers.all(query, params);
    const formatted = records.map((record) => ({
      id: record.id,
      patientName: record.patient_name,
      patientId: record.patient_id,
      createdAt: record.created_at,
      fileName: record.file_name,
      mimeType: record.mime_type,
      flagged: Boolean(record.flagged_id),
    }));

    res.json({success: true, data: formatted});
  } catch (error) {
    console.error('Benchmark suggestions error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

async function runBenchmark(req, res) {
  try {
    const {audioRecordId, promptText} = req.body || {};

    if (!audioRecordId) {
      return res.status(400).json({
        success: false,
        error: 'Audio record ID is required.',
      });
    }

    const audioRecord = await dbHelpers.get(
      'SELECT * FROM audio_records WHERE id = $1',
      [audioRecordId]
    );

    if (!audioRecord) {
      return res.status(404).json({
        success: false,
        error: 'Audio record not found.',
      });
    }

    const audioPath = audioRecord.file_path;
    const mimeType = audioRecord.mime_type;

    const results = [];

    for (const model of MODEL_DEFINITIONS) {
      const modelName = process.env[model.envKey] || model.defaultModel;
      try {
        const playbackUrl = await resolvePlaybackUrl(audioRecord);
        if (!playbackUrl && (!audioPath || !fs.existsSync(audioPath))) {
          return res.status(404).json({
            success: false,
            error: 'Audio file not found on server.',
          });
        }
        const output = await generateBenchmarkAudio({
          audioPath: playbackUrl ? null : audioPath,
          audioUrl: playbackUrl || null,
          mimeType,
          patientId: audioRecord.patient_id || null,
          modelName,
          promptText,
        });
        results.push({
          modelId: model.id,
          label: model.label,
          modelName,
          output,
        });
      } catch (error) {
        results.push({
          modelId: model.id,
          label: model.label,
          modelName,
          error: error?.message || 'Model request failed.',
        });
      }
    }

    const shuffled = shuffle(results);
    const optionLabels = ['A', 'B', 'C'];
    const runId = uuidv4();
    const optionMap = {};
    const anonymized = shuffled.map((item, index) => {
      const optionId = uuidv4();
      optionMap[optionId] = item.modelId;
      return {
        optionId,
        label: optionLabels[index] || `Option ${index + 1}`,
        output: item.output,
        error: item.error,
      };
    });

    runStore.set(runId, {
      createdAt: Date.now(),
      audioRecordId,
      optionMap,
    });
    pruneRuns();

    res.json({
      success: true,
      data: {
        audioRecordId,
        patientName: audioRecord.patient_name || null,
        patientId: audioRecord.patient_id || null,
        createdAt: audioRecord.created_at,
        fileName: audioRecord.file_name || null,
        runId,
        results: anonymized,
      },
    });
  } catch (error) {
    console.error('Benchmark run error:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error.',
    });
  }
}

async function getBenchmarkScores(req, res) {
  try {
    const rows = await dbHelpers.all('SELECT * FROM benchmark_scores', []);
    const scoreMap = new Map(rows.map((row) => [row.model_id, row.wins || 0]));
    const data = MODEL_DEFINITIONS.map((model) => ({
      modelId: model.id,
      label: model.label,
      wins: scoreMap.get(model.id) || 0,
    }));
    res.json({success: true, data});
  } catch (error) {
    console.error('Benchmark scores error:', error);
    res.status(500).json({success: false, error: 'Internal server error.'});
  }
}

async function getBenchmarkPromptText(req, res) {
  try {
    const prompt = getBenchmarkPrompt();
    res.json({success: true, data: {prompt}});
  } catch (error) {
    console.error('Benchmark prompt error:', error);
    res.status(500).json({success: false, error: 'Internal server error.'});
  }
}

async function resolvePlaybackUrl(audioRecord) {
  if (audioRecord?.storage_path && isStorageConfigured()) {
    const signedUrl = await createSignedAudioUrl(audioRecord.storage_path, 600);
    if (signedUrl) return signedUrl;
  }
  if (audioRecord?.file_url) {
    return audioRecord.file_url;
  }
  return null;
}

async function getBenchmarkAudio(req, res) {
  try {
    const {id} = req.params;
    const audioRecord = await dbHelpers.get('SELECT * FROM audio_records WHERE id = $1', [id]);
    if (!audioRecord) {
      return res.status(404).json({
        success: false,
        error: 'Audio record not found.',
      });
    }

    const mimeType = audioRecord.mime_type || 'audio/mp4';

    const playbackUrl = await resolvePlaybackUrl(audioRecord);
    if (playbackUrl) {
      try {
        const upstream = await fetch(playbackUrl);
        if (!upstream.ok) {
          return res.redirect(playbackUrl);
        }
        res.set('Content-Type', mimeType);
        const contentLength = upstream.headers.get('content-length');
        if (contentLength) {
          res.set('Content-Length', contentLength);
        }
        res.set('Accept-Ranges', 'bytes');
        const nodeStream = require('stream').Readable.fromWeb(upstream.body);
        nodeStream.pipe(res);
        return;
      } catch (_proxyErr) {
        return res.redirect(playbackUrl);
      }
    }

    if (!audioRecord.file_path || !fs.existsSync(audioRecord.file_path)) {
      return res.status(404).json({
        success: false,
        error: 'Audio file not found on server.',
      });
    }

    const resolvedPath = path.resolve(audioRecord.file_path);
    res.set('Content-Type', mimeType);
    res.sendFile(resolvedPath);
  } catch (error) {
    console.error('Benchmark audio error:', error);
    res.status(500).json({success: false, error: 'Internal server error.'});
  }
}

async function submitBenchmarkScore(req, res) {
  try {
    const {runId, optionId} = req.body || {};

    if (!runId || !optionId) {
      return res.status(400).json({
        success: false,
        error: 'Run ID and option ID are required.',
      });
    }

    pruneRuns();
    const run = runStore.get(runId);
    if (!run) {
      return res.status(410).json({
        success: false,
        error: 'Benchmark session expired. Please run again.',
      });
    }

    const modelId = run.optionMap[optionId];
    if (!modelId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid option selected.',
      });
    }

    await dbHelpers.run(
      `INSERT INTO benchmark_votes (run_id, transcript_id, audio_record_id, user_uid, model_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [runId, null, run.audioRecordId || null, null, modelId]
    );

    await dbHelpers.run(
      `INSERT INTO benchmark_scores (model_id, wins, updated_at)
       VALUES ($1, 1, NOW())
       ON CONFLICT (model_id) DO UPDATE
       SET wins = benchmark_scores.wins + 1,
           updated_at = NOW()`,
      [modelId]
    );

    runStore.delete(runId);

    const rows = await dbHelpers.all('SELECT * FROM benchmark_scores', []);
    const scoreMap = new Map(rows.map((row) => [row.model_id, row.wins || 0]));
    const data = MODEL_DEFINITIONS.map((model) => ({
      modelId: model.id,
      label: model.label,
      wins: scoreMap.get(model.id) || 0,
    }));

    res.json({success: true, data});
  } catch (error) {
    console.error('Benchmark score error:', error);
    res.status(500).json({success: false, error: 'Internal server error.'});
  }
}

async function backfillBenchmarkAudio(req, res) {
  try {
    if (!isStorageConfigured()) {
      return res.status(400).json({
        success: false,
        error: 'Supabase storage is not configured.',
      });
    }

    const records = await dbHelpers.all(
      `SELECT id, file_path, file_name, mime_type
       FROM audio_records
       WHERE (file_url IS NULL OR file_url = '')
         AND file_path IS NOT NULL`,
      []
    );

    let processed = 0;
    let uploaded = 0;
    let missing = 0;
    const failures = [];

    for (const record of records) {
      processed += 1;
      if (!record.file_path || !fs.existsSync(record.file_path)) {
        missing += 1;
        continue;
      }
      try {
        const uploadResult = await uploadAudioFile({
          filePath: record.file_path,
          fileName: record.file_name,
          recordId: record.id,
          mimeType: record.mime_type,
        });
        if (uploadResult) {
          await dbHelpers.run(
            'UPDATE audio_records SET file_url = $1, storage_path = $2 WHERE id = $3',
            [uploadResult.publicUrl, uploadResult.storagePath, record.id]
          );
          uploaded += 1;
        }
      } catch (error) {
        failures.push({id: record.id, error: error?.message || 'Upload failed'});
      }
    }

    res.json({
      success: true,
      data: {
        processed,
        uploaded,
        missing,
        failed: failures.length,
        failures,
      },
    });
  } catch (error) {
    console.error('Benchmark backfill error:', error);
    res.status(500).json({success: false, error: 'Internal server error.'});
  }
}

module.exports = {
  getBenchmarkSuggestions,
  runBenchmark,
  getBenchmarkScores,
  getBenchmarkPromptText,
  getBenchmarkAudio,
  submitBenchmarkScore,
  backfillBenchmarkAudio,
};
