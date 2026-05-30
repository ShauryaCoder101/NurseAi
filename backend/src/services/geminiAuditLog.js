const crypto = require('crypto');
const { dbHelpers } = require('../config/database');

function hashPrompt(text) {
  if (!text) return null;
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// Fire-and-forget: call without awaiting from controllers/services
async function insertGeminiAuditLog(data) {
  try {
    await dbHelpers.run(
      `INSERT INTO gemini_audit_log (
        stage, user_uid, patient_id, audio_record_id, transcript_id,
        model_used, was_fallback_model,
        prompt_text, prompt_hash,
        prompt_token_count, output_token_count,
        latency_ms, finish_reason,
        safety_ratings, raw_response,
        reasoning_text, final_output,
        retry_count, error_message
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
      )`,
      [
        data.stage,
        data.userUid || null,
        data.patientId || null,
        data.audioRecordId || null,
        data.transcriptId || null,
        data.modelUsed || null,
        data.wasFallbackModel || false,
        data.promptText || null,
        hashPrompt(data.promptText),
        data.promptTokenCount ?? null,
        data.outputTokenCount ?? null,
        data.latencyMs ?? null,
        data.finishReason || null,
        data.safetyRatings ? JSON.stringify(data.safetyRatings) : null,
        data.rawResponse ? JSON.stringify(data.rawResponse) : null,
        data.reasoningText || null,
        data.finalOutput || null,
        data.retryCount ?? 0,
        data.errorMessage || null,
      ]
    );
  } catch (err) {
    console.error('[AuditLog] Failed to write gemini_audit_log:', err.message);
  }
}

module.exports = { insertGeminiAuditLog };
