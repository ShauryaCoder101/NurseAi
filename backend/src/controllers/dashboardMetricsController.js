const {dbHelpers} = require('../config/database');

// Curated Benchmark Batch: 37 from B3 + 13 from B2 = 50 cases
const CURATED_BATCH_IDS = [
  // B3 (all except cases #8, #15, #37)
  '0d222c16-ec57-418a-a466-624f394899ee', '56e62e64-8221-44a3-8423-5d17fba762e0',
  'b43dd0ac-430e-44b2-b8b8-9e1987474434', 'ee0e414e-583d-41f7-8546-a783e10a19f1',
  '71d6c4f1-f31c-421d-9ed6-94da11b7de8e', 'a7a3fb33-4d6d-4103-a969-30f8f3649f4b',
  '4942f565-2c60-4cf8-bb61-45f53b2bdd1b', '800a0e98-2134-4776-b745-78a25d361786',
  'e85465c5-835d-491e-8dfd-6e2fd46efe51', '3cf0d536-872a-4b2e-bd62-502c6987e8f2',
  'ff4a6a39-141a-441f-8fb4-c14c677a6fcb', '977eb422-c8d2-489f-ae74-bfc21615e116',
  'f861eea3-c499-41d2-8727-d0181462ca10', '1a04863c-1119-4026-a6fe-db7eb726f2ff',
  'ef0f22d6-6987-4e03-bb75-637ded65da45', '7a81b808-a956-40ff-8667-85055908646f',
  '6d2c4922-2dbb-4a5a-bdf1-8c88d957eee6', 'e69d9d87-770f-41b7-828a-b30904cb6d24',
  '07344597-9c10-438c-bbc3-3ba1fae0f6d2', '4fc69fb5-ebd0-4103-a1e0-7586de7b3233',
  '2a98a7fb-55fb-44b8-9a39-eff265448df0', '788a5c02-2681-4e76-be73-6063c33b3c90',
  '6d262452-7afc-4e89-b9aa-5a98079bea3e', '991e0e50-b9f0-42a6-ac71-a3c43d312480',
  '4e7a58ef-d8e1-4394-8763-8215e573a660', 'b3b111ef-a5de-43b3-9b84-ee21c0b34f48',
  '06c3be66-d402-4311-ab24-56d1c80e6f3f', '51c248ae-a9da-4dfc-b31c-39f855d44ead',
  '7f9482cf-be29-4742-a97b-7239acf306d0', '18b21be6-f834-4b7b-b732-1c543b6a1b3d',
  'ac88d7f7-66d4-4402-91d0-d32f0e4c781a', '4af6094e-af2b-4cae-8f50-9724da675cb8',
  'b656a062-f20b-4232-ade8-81d1f7b0d290', '9dd0b47a-1a3f-4826-bb52-e70254b7fd45',
  '1746e28c-a8e6-44e0-878a-1876dd691138', '4fd0bffe-a54e-4ce4-bd86-38c2155a4591',
  'ff8205e6-d019-42e4-ac79-528e853601f8',
  // B2 (cases #2,3,4,5,9,11,12,14,17,20,21,23,26)
  '0712a938-0c34-40d0-a20f-82547231d647',
  '1ccc1c21-82f7-47c1-a334-2c386bfc4077', '2fce1c73-d84e-44c0-8311-c0625889690d',
  '03ba742d-f432-4fff-81e1-67dde9aa108d', '36cf3361-2c79-491b-94a9-127997c8c127',
  '6bbf50c6-da50-4ca6-9713-c4c224f80958', '7b4cb518-22b1-49ea-b80a-5a346f022aec',
  'ba1df520-0a17-4953-b035-fe28356d17d2', '2d561743-4d77-487f-9f61-cece9e83ea8c',
  '068e4e9b-4a05-485f-9328-3273ae52cdd5', '7ec97997-9f4c-4ccd-9259-4de0ac4d439d',
  'fab3840c-2c39-48ce-a0a9-05844291fb43',
  'aa551d88-c4bd-490f-9e58-e1d20d51f74d',
];

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

    // Compute B1 cases judged by both doctors (used for doctor cards AND case table)
    const DOCTOR_EMAILS = ['tripathiabhitesh@gmail.com', 'drchetanyamalik86@gmail.com'];
    const allB1Cases = await dbHelpers.all("SELECT id, file_name FROM bench_records WHERE COALESCE(batch, 'benchmark-1') = 'benchmark-1' ORDER BY created_at ASC");
    const bothCompleted = await dbHelpers.all(`
      SELECT bc1.audio_record_id FROM benchmarking_completed bc1
      JOIN benchmarking_completed bc2 ON bc1.audio_record_id = bc2.audio_record_id
      JOIN doctors d1 ON d1.id = bc1.evaluator_id
      JOIN doctors d2 ON d2.id = bc2.evaluator_id
      WHERE d1.username = $1 AND d2.username = $2
    `, DOCTOR_EMAILS);
    const bothCompletedSet = new Set(bothCompleted.map(r => r.audio_record_id));
    const b1BothCases = allB1Cases.filter(c => bothCompletedSet.has(c.id));
    const b1BothIds = b1BothCases.map(c => c.id);
    const b1BothSet = new Set(b1BothIds);

    // Benchmarking stats per doctor (filtered to only the 50 B1 both-judged cases)
    const b1Placeholders = b1BothIds.map((_, i) => `$${i + 1}`).join(',');
    const b1PlaceholdersFrom2 = b1BothIds.map((_, i) => `$${i + 2}`).join(',');
    const doctors = await dbHelpers.all(`
      SELECT DISTINCT
        d.username AS doctor_email,
        d.doctor_name,
        bc.evaluator_id
      FROM benchmarking_completed bc
      JOIN doctors d ON d.id = bc.evaluator_id
      WHERE d.username IN ('tripathiabhitesh@gmail.com', 'drchetanyamalik86@gmail.com')
    `);

    const benchmarking = [];
    for (const doc of doctors) {
      const completedCount = await dbHelpers.get(
        `SELECT COUNT(*) as count FROM benchmarking_completed WHERE evaluator_id = $1 AND audio_record_id IN (${b1PlaceholdersFrom2})`,
        [doc.evaluator_id, ...b1BothIds]
      );

      const evalCounts = await dbHelpers.all(`
        SELECT criterion, value, COUNT(*) as count
        FROM benchmarking_evaluations
        WHERE evaluator_id = $1 AND audio_record_id IN (${b1PlaceholdersFrom2})
        GROUP BY criterion, value
      `, [doc.evaluator_id, ...b1BothIds]);

      const negativeDetails = await dbHelpers.all(`
        SELECT be.criterion, be.value, be.comment,
               COALESCE(ar.patient_id, br.file_name) AS patient_id,
               COALESCE(ar.patient_name, br.file_name) AS patient_name
        FROM benchmarking_evaluations be
        LEFT JOIN audio_records ar ON ar.id = be.audio_record_id
        LEFT JOIN bench_records br ON br.id = be.audio_record_id
        WHERE be.evaluator_id = $1
          AND be.audio_record_id IN (${b1PlaceholdersFrom2})
          AND (
            (be.criterion = 'valid' AND be.value = 'Invalid')
            OR (be.criterion = 'appropriate' AND be.value = 'Inappropriate')
            OR (be.criterion = 'safe_severe' AND be.value = 'Harmful')
            OR (be.criterion = 'explainable' AND be.value = 'No')
          )
      `, [doc.evaluator_id, ...b1BothIds]);

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

    // But first: Curated Batch doctor stats filtered to curated IDs
    const curatedPlaceholders = CURATED_BATCH_IDS.map((_, i) => `$${i + 1}`).join(', ');
    const curatedPlaceholdersFrom2 = CURATED_BATCH_IDS.map((_, i) => `$${i + 2}`).join(', ');
    const curatedDoctors = await dbHelpers.all(`
      SELECT DISTINCT d.username AS doctor_email, d.doctor_name, bc.evaluator_id
      FROM benchmarking_completed bc JOIN doctors d ON d.id = bc.evaluator_id
      WHERE bc.audio_record_id IN (${curatedPlaceholders})
    `, CURATED_BATCH_IDS);

    const curatedDoctorStats = [];
    for (const cdoc of curatedDoctors) {
      const cCompletedCount = await dbHelpers.get(
        `SELECT COUNT(*) as count FROM benchmarking_completed WHERE evaluator_id = $1 AND audio_record_id IN (${curatedPlaceholdersFrom2})`,
        [cdoc.evaluator_id, ...CURATED_BATCH_IDS]
      );
      const cEvalCounts = await dbHelpers.all(`
        SELECT criterion, value, COUNT(*) as count FROM benchmarking_evaluations
        WHERE evaluator_id = $1 AND audio_record_id IN (${curatedPlaceholdersFrom2}) GROUP BY criterion, value
      `, [cdoc.evaluator_id, ...CURATED_BATCH_IDS]);
      const cNegDetails = await dbHelpers.all(`
        SELECT be.criterion, be.value, be.comment,
               COALESCE(ar.patient_id, br.file_name) AS patient_id, COALESCE(ar.patient_name, br.file_name) AS patient_name
        FROM benchmarking_evaluations be LEFT JOIN audio_records ar ON ar.id = be.audio_record_id
        LEFT JOIN bench_records br ON br.id = be.audio_record_id
        WHERE be.evaluator_id = $1 AND be.audio_record_id IN (${curatedPlaceholdersFrom2})
          AND ((be.criterion='valid' AND be.value='Invalid') OR (be.criterion='appropriate' AND be.value='Inappropriate')
          OR (be.criterion='safe_severe' AND be.value='Harmful') OR (be.criterion='explainable' AND be.value='No'))
      `, [cdoc.evaluator_id, ...CURATED_BATCH_IDS]);
      const cCounts = {};
      for (const e of cEvalCounts) { if (!cCounts[e.criterion]) cCounts[e.criterion] = {}; cCounts[e.criterion][e.value] = parseInt(e.count); }
      curatedDoctorStats.push({
        doctorEmail: cdoc.doctor_email, doctorName: cdoc.doctor_name,
        casesEvaluated: parseInt(cCompletedCount?.count || 0),
        valid: cCounts.valid?.Valid || 0, invalid: cCounts.valid?.Invalid || 0,
        appropriate: cCounts.appropriate?.Appropriate || 0, inappropriate: cCounts.appropriate?.Inappropriate || 0,
        safe: cCounts.safe_severe?.Safe || 0, harmful: cCounts.safe_severe?.Harmful || 0,
        explainableYes: cCounts.explainable?.Yes || 0, explainableNo: cCounts.explainable?.No || 0,
        negativeDetails: cNegDetails.map(d => ({ criterion: d.criterion, value: d.value, comment: d.comment || '',
          patientId: d.patient_id || d.patient_name || 'Unknown', patientName: d.patient_name || '' })),
      });
    }

    // Case-level evaluations for both doctors
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

    const caseEvaluations = b1BothCases.map((c, idx) => {
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

    // Curated Batch: case-level evaluations filtered to curated IDs
    const curatedIdSet = new Set(CURATED_BATCH_IDS);
    const allBenchCases = await dbHelpers.all('SELECT id, file_name FROM bench_records ORDER BY created_at ASC');
    const curatedCases = CURATED_BATCH_IDS.map(id => allBenchCases.find(c => c.id === id)).filter(Boolean);
    const curatedCaseEvaluations = curatedCases.map((c, idx) => {
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
        curatedBatch: {
          doctorStats: curatedDoctorStats,
          caseEvaluations: curatedCaseEvaluations,
        },
        llmResults,
      },
    });
  } catch (error) {
    console.error('Public metrics error:', error);
    res.status(500).json({success: false, error: error.message});
  }
}

module.exports = {getPublicMetrics};
