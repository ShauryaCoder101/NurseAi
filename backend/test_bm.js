require('dotenv').config();
const {dbHelpers} = require('./src/config/database');
setTimeout(async () => {
  try {
    // Check benchmarking_completed table
    await dbHelpers.run(`
      CREATE TABLE IF NOT EXISTS benchmarking_completed (
        audio_record_id UUID NOT NULL,
        evaluator_id UUID NOT NULL,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (audio_record_id, evaluator_id)
      )
    `);
    console.log('Completed table OK');

    const audioId = '4c919664-b0c2-4f57-98bf-b623d183925f';
    const evalId = '4f2e37fc-2191-48d1-839a-6f90bba79dbc';

    // Full simulation of submitEvaluation
    const evaluations = [
      { criterion: 'valid', value: 'Valid', comment: '' },
      { criterion: 'appropriate', value: 'Appropriate', comment: '' },
      { criterion: 'safe_severe', value: 'Safe', comment: '' }
    ];

    for (const ev of evaluations) {
      await dbHelpers.run(`
        INSERT INTO benchmarking_evaluations (audio_record_id, evaluator_id, evaluator_name, criterion, value, comment)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (audio_record_id, evaluator_id, criterion)
        DO UPDATE SET value = $5, comment = $6, updated_at = CURRENT_TIMESTAMP
      `, [audioId, evalId, 'TestDoc', ev.criterion, ev.value, ev.comment || null]);
    }
    console.log('All evals saved OK');

    await dbHelpers.run(
      'INSERT INTO benchmarking_completed (audio_record_id, evaluator_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [audioId, evalId]
    );
    console.log('Marked completed OK');
  } catch (e) {
    console.error('ERROR:', e.message);
    console.error('Detail:', e.detail || e.hint || '');
  }
  process.exit();
}, 2000);
