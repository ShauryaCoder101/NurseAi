/**
 * In-memory retriever for the ICMR STW guideline corpus.
 *
 * Why in-memory and not SQLite/pgvector: the corpus is static and tiny
 * (163 page-level chunks, ~7.5 MB of 3072-dim vectors). The whole index loads into RAM
 * once at first use; a brute-force cosine scan over ~160 vectors is sub-millisecond.
 * No native deps, no DB lifecycle, works offline, version-controlled as JSON.
 *
 * The index file (rag/data/guidelines.embeddings.json) is produced offline by
 * `npm run rag:ingest`. If it is absent, retrieval degrades to a no-op so the
 * app keeps working (callers simply get no grounding context).
 */
const fs = require('fs');
const path = require('path');
const { embedText } = require('./embeddings');

const INDEX_PATH = path.join(__dirname, '../../../rag/data/guidelines.embeddings.json');
const DEFAULT_TOP_K = Number(process.env.RAG_TOP_K || 5);
const MIN_SCORE = Number(process.env.RAG_MIN_SCORE || 0.55);

let index = null; // { chunks: [...], norms: [...] } | 'missing'

function loadIndex() {
  if (index !== null) return index;
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf-8');
    const chunks = JSON.parse(raw);
    const norms = chunks.map((c) => Math.hypot(...c.embedding));
    index = { chunks, norms };
    console.log(`[RAG] loaded ${chunks.length} guideline chunks into memory`);
  } catch (err) {
    index = 'missing';
    console.warn(
      `[RAG] guideline index not found at ${INDEX_PATH} ` +
      `(${err.code || err.message}). Retrieval disabled — run "npm run rag:ingest".`
    );
  }
  return index;
}

function cosine(a, b, normB) {
  let dot = 0;
  let normA = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
  }
  normA = Math.sqrt(normA);
  if (!normA || !normB) return 0;
  return dot / (normA * normB);
}

/**
 * Retrieve the most relevant guideline chunks for a query.
 * @returns {Promise<Array<{id,citation_label,title,icd,text,score}>>}
 */
async function retrieve(queryText, topK = DEFAULT_TOP_K) {
  const idx = loadIndex();
  if (idx === 'missing' || !queryText || !queryText.trim()) return [];

  let qVec;
  try {
    qVec = await embedText(queryText, 'RETRIEVAL_QUERY');
  } catch (err) {
    console.warn(`[RAG] query embedding failed, skipping retrieval: ${err.message}`);
    return [];
  }

  const scored = idx.chunks.map((c, i) => ({
    chunk: c,
    score: cosine(c.embedding, qVec, idx.norms[i]),
  }));
  scored.sort((a, b) => b.score - a.score);

  return scored
    .filter((s) => s.score >= MIN_SCORE)
    .slice(0, topK)
    .map((s) => ({
      id: s.chunk.id,
      citation_label: s.chunk.citation_label,
      title: s.chunk.title,
      icd: s.chunk.icd,
      text: s.chunk.text,
      score: Number(s.score.toFixed(4)),
    }));
}

/**
 * Build a grounded-context block to inject into a prompt, plus the set of
 * citation tags the model is allowed to use (for post-generation validation).
 * Each chunk is tagged [G1], [G2], ... mapped to its full citation label.
 */
function buildGuidelineContext(chunks) {
  if (!chunks || !chunks.length) {
    return { contextBlock: '', allowedTags: new Set(), tagToLabel: {} };
  }
  const tagToLabel = {};
  const lines = chunks.map((c, i) => {
    const tag = `G${i + 1}`;
    tagToLabel[tag] = c.citation_label;
    return `[${tag}] ${c.citation_label}\n${c.text}`;
  });
  const contextBlock =
    '--- AUTHORITATIVE GUIDELINE PASSAGES (ICMR Standard Treatment Workflows) ---\n' +
    'These are the ONLY sources you may cite. Cite a claim by appending its tag, ' +
    'e.g. [G2]. Do NOT cite any guideline, study, or source not listed here. ' +
    'If no passage supports a recommendation, write "No STW guidance available for ' +
    'this point" instead of inventing a citation.\n\n' +
    lines.join('\n\n') +
    '\n--- END GUIDELINE PASSAGES ---';
  return { contextBlock, allowedTags: new Set(Object.keys(tagToLabel)), tagToLabel };
}

/**
 * Replace inline [G#] tags in the model output with their full citation labels,
 * and strip any [G#] tag that was not in the retrieved set (kills ghost citations).
 */
function resolveCitations(text, tagToLabel) {
  if (!text) return text;
  return text.replace(/\[(G\d+)\]/g, (m, tag) =>
    tagToLabel[tag] ? `[${tagToLabel[tag]}]` : ''
  );
}

function isReady() {
  return loadIndex() !== 'missing';
}

module.exports = { retrieve, buildGuidelineContext, resolveCitations, isReady };
