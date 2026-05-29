# Engineering Decisions and To-Dos

This document tracks planned architectural optimizations and engineering tasks for the NurseAI backend, specifically focusing on latency reduction and performance improvements.

## 🚀 Priority To-Dos (Latency Reduction)

These optimizations focus on reducing the perceived "Time To First Token" (TTFT) for critical LLM responses.

### 1. Decouple Supabase Upload from LLM Critical Path
**Current State:** In `backend/src/controllers/audioController.js`, the synchronous upload to Supabase (`uploadAudioFile`) blocks the subsequent Gemini LLM call (`generateDiagnosisFromAudio`). If the upload is slow, the user waits longer for their diagnosis.
**Action Required:**
- Refactor `uploadAudioFile` to execute asynchronously (e.g., using `Promise.all` or a fire-and-forget background job) relative to the Gemini API call.
- The Gemini call should begin immediately after the audio is saved locally to the `uploads/` directory, minimizing wait time for the user.
- Ensure the database is eventually updated with the `fileUrl` and `storagePath` once the background upload completes.

### 2. Remove Unnecessary Patient History Fetches
**Context:** Our current operational model involves strictly one-off patient episodes. The longitudinal history feature is not currently utilized.
**Current State:** The `fetchPatientHistory` function is called before `generateDiagnosisFromAudio` and `generatePrescription`, adding unnecessary database query overhead and consuming LLM context window tokens.
**Action Required:**
- Remove the `fetchPatientHistory` call from the workflow for diagnosis and prescription generation.
- Remove the `patientHistory` parameter from the respective Gemini service functions and prompt templates.
- Ensure this doesn't break any prompt logic that explicitly depends on the presence/absence of that context block.

---

## 🔍 Future Considerations

### 1. Model Migration Evaluation (e.g., Gemini 3.5 Flash)
- We are currently defaulting to `gemini-3.1-pro-preview`.
- Evaluate whether transitioning to faster, lower-cost models (like Gemini 3.5 Flash) is viable for specific stages (especially Proforma Extraction) without sacrificing clinical accuracy.
- This requires rigorous A/B testing and human-in-the-loop validation of the outputs before changing the default model in production.

### 2. Review Two-Step Proforma Generation
- The `generateExtractedProforma` function currently uses two sequential Gemini calls (Extraction -> Generation).
- While this ensures structure, investigate if advancements in multimodal prompting allow for a single, highly accurate call to reduce latency for the initial interview stage.