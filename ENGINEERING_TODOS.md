# Engineering Decisions and To-Dos

This document tracks planned architectural optimizations and engineering tasks for the NurseAI backend, specifically focusing on latency reduction and performance improvements.

---

## ✅ Completed

### Latency Reduction

#### 1. Decouple Supabase Upload from LLM Critical Path
**Implemented:** `backend/src/controllers/audioController.js`
- `uploadAudioFile` is now fire-and-forget. The Gemini diagnosis call starts immediately after the DB insert without waiting for the Supabase upload to finish.
- The DB is updated with `file_url` and `storage_path` asynchronously once the background upload completes.
- Note: the immediate API response returns `fileUrl: null`; the correct URL is available in the DB within seconds.

#### 2. Remove Unnecessary Patient History Fetches
**Implemented:** `backend/src/controllers/audioController.js`, `backend/src/services/geminiService.js`
- Removed `fetchPatientHistory()` calls before `generateDiagnosisFromAudio` and `generatePrescription`.
- Removed `patientHistory` parameter and prompt injection blocks from both Gemini service functions.
- `generateGeminiFollowup` retains its patient history support for potential future use.

### Reliability & Observability

#### 3. Gemini Response Logging
**Implemented:** `backend/src/services/geminiService.js`
- Added `logGeminiCandidate(source, data)` helper that logs `finishReason`, part count, and token usage after every Gemini call.
- When a response has no parts (empty/blocked), the full raw response is dumped to console for diagnosis.
- Covers all 7 content generation functions: `generateGeminiSuggestion`, `generateGeminiFollowup`, `generateBenchmarkResponse`, `generateExtractedProforma`, `generateDiagnosisFromAudio`, `generatePrescription`, `generateProformaResponse`, `generateBenchmarkAudio`.

#### 4. Deterministic LLM Outputs (temperature = 0)
**Implemented:** `backend/src/services/geminiService.js`
- Added `GENERATION_CONFIG = { temperature: 0 }` constant.
- Applied to all 8 Gemini request bodies via `generationConfig: GENERATION_CONFIG`.
- Eliminates sampling randomness — critical for clinical safety and reproducibility.

#### 5. Prescription Text Type Safety Fix
**Implemented:** `backend/src/controllers/audioController.js`
- Fixed `TypeError: prescriptionText.trim is not a function` crash.
- Root cause: `prescriptionResult.text || prescriptionResult` fell back to the whole object when `text` was an empty string (falsy). Changed to nullish coalescing (`??`) with an explicit type check.

#### 6. Delete Local Audio Files After Supabase Upload
**Implemented:** `backend/src/controllers/audioController.js`, `backend/src/controllers/metricsController.js`
- After a successful Supabase upload and DB update, the local copy in `uploads/audio/` is now deleted via `fs.unlink`.
- Prevents indefinite disk accumulation of audio files that are already stored in Supabase.
- `benchmarkController.js` (backfill endpoint) intentionally excluded — it uploads pre-existing local files and should not delete its source.

#### 7. Stop Writing to `ai_reasoning_log`
**Implemented:** `backend/src/controllers/audioController.js`, `backend/src/controllers/transcriptController.js`
- Removed INSERT calls to `ai_reasoning_log` for the diagnosis, prescription, and followup stages.
- `gemini_audit_log` captures a superset of this data (reasoning text, model, stage, token counts, latency) and is now the single write target for AI call auditing.
- The `ai_reasoning_log` table and its read queries in `patientRecordController.js` and `patientRecordHtmlService.js` are retained to keep existing historical data accessible.

---

## 🔍 Future Considerations

### 1. Model Migration Evaluation (e.g., Gemini 3.5 Flash)
- Currently using `gemini-3.5-flash` as configured in `backend/.env`.
- Evaluate whether further model changes are viable for specific stages (especially Proforma Extraction) without sacrificing clinical accuracy.
- Requires rigorous A/B testing and human-in-the-loop validation before changing defaults in production.

### 2. Review Two-Step Proforma Generation
- `generateExtractedProforma` currently uses two sequential Gemini calls (Extraction → Generation).
- Investigate if a single multimodal call can match accuracy while halving latency for the initial interview stage.

### 3. Re-enable Longitudinal Patient History (when operationally needed)
- `fetchPatientHistory` and the `patientHistory` prompt injection were removed from diagnosis and prescription flows (see item 2 above).
- When multi-visit patient tracking becomes a requirement, re-add the parameter to `generateDiagnosisFromAudio` and `generatePrescription` and restore the `fetchPatientHistory` calls.