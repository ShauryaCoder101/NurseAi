/**
 * NLP Merge Service — uses Gemini to semantically extract clinical entities
 * from multiple LLM responses and build a majority-vote consensus.
 */

const {generateBenchmarkResponse} = require('./geminiService');

// ── 1. Extract structured entities from a clinical response ────────────────────
const EXTRACTION_PROMPT = `You are a medical NLP extraction tool. Given a clinical response, extract the following into strict JSON (no markdown, no commentary):
{
  "diagnoses": [{"name": "...", "confidence": "high|medium|low"}],
  "medications": [{"name": "...", "dose": "...", "frequency": "...", "duration": "..."}],
  "tests": [{"name": "...", "tier": "1|2", "reason": "..."}],
  "advice": ["..."],
  "red_flags": ["..."],
  "follow_up": "..."
}
If a field has no data, use an empty array or empty string.

Clinical response to extract from:
`;

async function extractEntities(responseText) {
  const prompt = EXTRACTION_PROMPT + responseText;
  const raw = await generateBenchmarkResponse({promptText: prompt});

  // Try to parse JSON from the response (Gemini may wrap it in code fences)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {diagnoses: [], medications: [], tests: [], advice: [], red_flags: [], follow_up: ''};
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return {diagnoses: [], medications: [], tests: [], advice: [], red_flags: [], follow_up: '', raw};
  }
}

// ── 2. Semantic deduplication via Gemini ────────────────────────────────────────
const DEDUP_PROMPT = `You are a medical NLP deduplication tool. Given arrays of clinical items from 3 different AI responses, merge duplicates that are semantically equivalent (e.g., "Paracetamol" and "Acetaminophen" are the same, "CBC" and "Complete Blood Count" are the same).

For each unique item, count how many of the 3 sources mentioned it (support count 1-3).

Return strict JSON (no markdown):
{
  "diagnoses": [{"name": "...", "support": N}],
  "medications": [{"name": "...", "dose": "...", "support": N}],
  "tests": [{"name": "...", "support": N}],
  "advice": [{"text": "...", "support": N}]
}

Source A items:
DIAGNOSES_A

Source B items:
DIAGNOSES_B

Source C items:
DIAGNOSES_C
`;

async function deduplicateEntities(entitiesA, entitiesB, entitiesC) {
  const prompt = DEDUP_PROMPT
    .replace('DIAGNOSES_A', JSON.stringify(entitiesA))
    .replace('DIAGNOSES_B', JSON.stringify(entitiesB))
    .replace('DIAGNOSES_C', JSON.stringify(entitiesC));

  const raw = await generateBenchmarkResponse({promptText: prompt});

  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {diagnoses: [], medications: [], tests: [], advice: []};
  }
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return {diagnoses: [], medications: [], tests: [], advice: [], raw};
  }
}

// ── 3. Build consensus from deduplicated items (majority = support >= 2) ──────
function buildConsensus(deduped) {
  return {
    diagnoses: (deduped.diagnoses || []).filter((d) => d.support >= 2),
    medications: (deduped.medications || []).filter((m) => m.support >= 2),
    tests: (deduped.tests || []).filter((t) => t.support >= 2),
    advice: (deduped.advice || []).filter((a) => a.support >= 2),
  };
}

// ── 4. Synthesize a merged clinical response from consensus items ──────────────
const SYNTHESIS_PROMPT = `You are a clinical AI. Given the following consensus items (agreed upon by at least 2 out of 3 independent AI systems), synthesize a coherent, well-structured clinical response.
Use the same format as a standard NurseAI clinical output: Case Synthesis, Differential Diagnosis, Diagnostic Tests (Tier 1/2), Prescription, Patient Education, Follow-up.
Do NOT use markdown formatting. Use plain text with dashes for bullet points.

Consensus items:
`;

async function synthesizeConsensus(consensus) {
  const prompt = SYNTHESIS_PROMPT + JSON.stringify(consensus, null, 2);
  return generateBenchmarkResponse({promptText: prompt});
}

// ── Main merge pipeline ────────────────────────────────────────────────────────
async function mergeResponses(responseA, responseB, responseC) {
  // Step 1: Extract entities from each response
  const [entA, entB, entC] = await Promise.all([
    extractEntities(responseA),
    extractEntities(responseB),
    extractEntities(responseC),
  ]);

  // Step 2: Semantic deduplication
  const deduped = await deduplicateEntities(entA, entB, entC);

  // Step 3: Majority vote
  const consensus = buildConsensus(deduped);

  // Step 4: Synthesize merged response
  const mergedResponse = await synthesizeConsensus(consensus);

  return {
    extractions: {a: entA, b: entB, c: entC},
    deduplicated: deduped,
    consensus,
    mergedResponse,
  };
}

module.exports = {
  extractEntities,
  deduplicateEntities,
  buildConsensus,
  synthesizeConsensus,
  mergeResponses,
};
