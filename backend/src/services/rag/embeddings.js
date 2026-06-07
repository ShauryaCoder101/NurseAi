/**
 * Gemini text embeddings for the STW guideline RAG.
 *
 * Uses the same REST endpoint / API key as geminiService.js (no SDK dependency).
 * Model: text-embedding-004 (768-dim). taskType improves retrieval quality by
 * embedding documents and queries into aligned subspaces.
 */
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_BASE_URL =
  process.env.GEMINI_API_BASE_URL ||
  'https://generativelanguage.googleapis.com/v1beta';
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';

/**
 * Embed a single piece of text.
 * @param {string} text
 * @param {'RETRIEVAL_DOCUMENT'|'RETRIEVAL_QUERY'} taskType
 * @returns {Promise<number[]>} embedding vector
 */
async function embedText(text, taskType = 'RETRIEVAL_QUERY') {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  if (!text || !text.trim()) throw new Error('embedText: empty text');

  const endpoint =
    `${GEMINI_API_BASE_URL}/models/${EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
  const body = {
    model: `models/${EMBED_MODEL}`,
    content: { parts: [{ text }] },
    taskType,
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Embedding API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  const values = data?.embedding?.values;
  if (!Array.isArray(values)) {
    throw new Error('Embedding API returned no vector');
  }
  return values;
}

module.exports = { embedText, EMBED_MODEL };
