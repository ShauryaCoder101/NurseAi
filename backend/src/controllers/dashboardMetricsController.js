const {dbHelpers} = require('../config/database');

async function getPublicMetrics(req, res) {
  try {
    // App stats
    const userCount = await dbHelpers.get('SELECT COUNT(*) as count FROM users');
    const audioCount = await dbHelpers.get('SELECT COUNT(*) as count FROM audio_records');
    const totalSize = await dbHelpers.get('SELECT COALESCE(SUM(file_size), 0) as total FROM audio_records');
    const flaggedCount = await dbHelpers.get('SELECT COUNT(*) as count FROM flagged_suggestions');
    const followupCount = await dbHelpers.get('SELECT COUNT(*) as count FROM followup_log');

    const users = parseInt(userCount?.count || 0);
    const totalUses = parseInt(audioCount?.count || 0);
    const avgUse = users > 0 ? (totalUses / users).toFixed(1) : '0';
    const totalAudioBytes = parseInt(totalSize?.total || 0);
    const estimatedMinutes = Math.round(totalAudioBytes / (1024 * 1024));

    // Benchmarking stats per doctor
    const doctors = await dbHelpers.all(`
      SELECT DISTINCT
        d.username AS doctor_email,
        d.doctor_name,
        bc.evaluator_id
      FROM benchmarking_completed bc
      JOIN doctors d ON d.id = bc.evaluator_id
    `);

    const benchmarking = [];
    for (const doc of doctors) {
      const completedCount = await dbHelpers.get(
        'SELECT COUNT(*) as count FROM benchmarking_completed WHERE evaluator_id = $1',
        [doc.evaluator_id]
      );

      const evalCounts = await dbHelpers.all(`
        SELECT criterion, value, COUNT(*) as count
        FROM benchmarking_evaluations
        WHERE evaluator_id = $1
        GROUP BY criterion, value
      `, [doc.evaluator_id]);

      const negativeDetails = await dbHelpers.all(`
        SELECT be.criterion, be.value, be.comment,
               COALESCE(ar.patient_id, br.file_name) AS patient_id,
               COALESCE(ar.patient_name, br.file_name) AS patient_name
        FROM benchmarking_evaluations be
        LEFT JOIN audio_records ar ON ar.id = be.audio_record_id
        LEFT JOIN bench_records br ON br.id = be.audio_record_id
        WHERE be.evaluator_id = $1
          AND (
            (be.criterion = 'valid' AND be.value = 'Invalid')
            OR (be.criterion = 'appropriate' AND be.value = 'Inappropriate')
            OR (be.criterion = 'safe_severe' AND be.value = 'Harmful')
            OR (be.criterion = 'explainable' AND be.value = 'No')
          )
      `, [doc.evaluator_id]);

      const counts = {};
      for (const e of evalCounts) {
        if (!counts[e.criterion]) counts[e.criterion] = {};
        counts[e.criterion][e.value] = parseInt(e.count);
      }

      benchmarking.push({
        doctorEmail: doc.doctor_email,
        doctorName: doc.doctor_name,
        casesEvaluated: parseInt(completedCount?.count || 0),
        valid: counts.valid?.Valid || 0,
        invalid: counts.valid?.Invalid || 0,
        appropriate: counts.appropriate?.Appropriate || 0,
        inappropriate: counts.appropriate?.Inappropriate || 0,
        safe: counts.safe_severe?.Safe || 0,
        harmful: counts.safe_severe?.Harmful || 0,
        explainableYes: counts.explainable?.Yes || 0,
        explainableNo: counts.explainable?.No || 0,
        negativeDetails: negativeDetails.map(d => ({
          criterion: d.criterion,
          value: d.value,
          comment: d.comment || '',
          patientId: d.patient_id || d.patient_name || 'Unknown',
          patientName: d.patient_name || '',
        })),
      });
    }

    // Case-level evaluations for both doctors
    const DOCTOR_EMAILS = ['tripathiabhitesh@gmail.com', 'drchetanyamalik86@gmail.com'];
    const allCases = await dbHelpers.all('SELECT id, file_name FROM bench_records ORDER BY created_at ASC');
    const allEvals = await dbHelpers.all(`
      SELECT be.audio_record_id, be.criterion, be.value, be.comment,
             d.username AS doctor_email
      FROM benchmarking_evaluations be
      JOIN doctors d ON d.id = be.evaluator_id
      WHERE d.username IN ($1, $2)
    `, DOCTOR_EMAILS);

    // Group evaluations by case + doctor
    const evalMap = {};
    for (const ev of allEvals) {
      const key = `${ev.audio_record_id}_${ev.doctor_email}`;
      if (!evalMap[key]) evalMap[key] = {};
      evalMap[key][ev.criterion] = {value: ev.value, comment: ev.comment || null};
    }

    const caseEvaluations = allCases.map((c, idx) => {
      const abhiteshKey = `${c.id}_${DOCTOR_EMAILS[0]}`;
      const chetanyaKey = `${c.id}_${DOCTOR_EMAILS[1]}`;
      return {
        caseNumber: idx + 1,
        fileName: c.file_name,
        audioId: c.id,
        abhitesh: evalMap[abhiteshKey] || {},
        chetanya: evalMap[chetanyaKey] || {},
      };
    });

    // LLM-as-a-Judge results
    function parseScore(str) {
      if (!str) return null;
      const m = String(str).match(/(\d+)\s*\/\s*100/);
      return m ? parseInt(m[1]) : null;
    }

    const llmRows = await dbHelpers.all(`
      SELECT blr.bench_record_id, blr.file_name,
             blr.fairness, blr.appropriateness, blr.ensemble, blr.safety
      FROM bench_llm_results blr
      JOIN bench_records br ON br.id = blr.bench_record_id
      ORDER BY br.created_at ASC
    `);

    const llmResults = llmRows.map((row, idx) => {
      const fair = row.fairness || {};
      const appr = row.appropriateness || {};
      const ens = row.ensemble || {};
      const safe = row.safety || {};

      // Extract fairness score from claude_judge string
      let fairScore = null;
      const claudeJudge = fair.claude_judge || '';
      const fairMatch = claudeJudge.match(/(\d+)\s*\/\s*100/);
      if (fairMatch) fairScore = parseInt(fairMatch[1]);

      // Extract appropriateness score
      let apprScore = null;
      for (const key of Object.keys(appr)) {
        if (key.toLowerCase().includes('chatgpt')) {
          apprScore = parseScore(appr[key]);
          break;
        }
      }

      // Extract ensemble sub-scores
      const ensScores = { deepseek: null, gemini: null, chatgpt: null, grok: null };
      for (const key of Object.keys(ens)) {
        const lk = key.toLowerCase();
        if (lk.includes('deepseek')) ensScores.deepseek = parseScore(ens[key]);
        else if (lk.includes('gemini')) ensScores.gemini = parseScore(ens[key]);
        else if (lk.includes('chatgpt')) ensScores.chatgpt = parseScore(ens[key]);
        else if (lk.includes('grok')) ensScores.grok = parseScore(ens[key]);
      }

      // Extract safety score from average
      const safeScore = parseScore(safe.average);

      return {
        caseNumber: idx + 1,
        fileName: row.file_name,
        fairness: fairScore,
        appropriateness: apprScore,
        ensemble: ensScores,
        safety: safeScore,
      };
    });

    res.json({
      success: true,
      data: {
        app: {
          totalUsers: users,
          avgUsePerUser: avgUse,
          totalUses,
          totalFlagged: parseInt(flaggedCount?.count || 0),
          followupQuestions: parseInt(followupCount?.count || 0),
          totalAudioMinutes: estimatedMinutes,
        },
        benchmarking,
        caseEvaluations,
        llmResults,
      },
    });
  } catch (error) {
    console.error('Public metrics error:', error);
    res.status(500).json({success: false, error: error.message});
  }
}

module.exports = {getPublicMetrics};
