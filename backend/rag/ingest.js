/**
 * Offline ingestion step 2: embed the page-level chunks produced by
 * extract_pdf.py and write the in-memory retriever's index.
 *
 *   chunks.json  --(embed each, RETRIEVAL_DOCUMENT)-->  guidelines.embeddings.json
 *
 * Run once (and again whenever the source PDFs change):
 *   1. python3 rag/extract_pdf.py     # PDFs -> rag/data/chunks.json
 *   2. npm run rag:ingest             # chunks.json -> guidelines.embeddings.json
 *
 * Requires GEMINI_API_KEY in the environment (or backend/.env).
 */
try { require('dotenv').config(); } catch (_) { /* dotenv optional; env may be set externally */ }
const fs = require('fs');
const path = require('path');
const { embedText, EMBED_MODEL } = require('../src/services/rag/embeddings');

const DATA_DIR = path.join(__dirname, 'data');
const CHUNKS_PATH = path.join(DATA_DIR, 'chunks.json');
const OUT_PATH = path.join(DATA_DIR, 'guidelines.embeddings.json');
const SLEEP_MS = Number(process.env.RAG_INGEST_SLEEP_MS || 150);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is not set. Add it to backend/.env or the environment.');
    process.exit(1);
  }
  if (!fs.existsSync(CHUNKS_PATH)) {
    console.error(`Missing ${CHUNKS_PATH}. Run: python3 rag/extract_pdf.py`);
    process.exit(1);
  }

  const chunks = JSON.parse(fs.readFileSync(CHUNKS_PATH, 'utf-8'));
  console.log(`Embedding ${chunks.length} chunks with ${EMBED_MODEL} ...`);

  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    // Prepend the title so the embedding is anchored to the condition name.
    const embedInput = `${c.title || ''}\n${c.text}`.trim();
    let embedding;
    try {
      embedding = await embedText(embedInput, 'RETRIEVAL_DOCUMENT');
    } catch (err) {
      console.error(`  ! chunk ${c.id} failed: ${err.message}`);
      process.exit(1);
    }
    out.push({
      id: c.id,
      citation_label: c.citation_label,
      doc_label: c.doc_label,
      title: c.title,
      icd: c.icd,
      page: c.page,
      text: c.text,
      embedding,
    });
    if ((i + 1) % 20 === 0 || i === chunks.length - 1) {
      console.log(`  ${i + 1}/${chunks.length}`);
    }
    if (SLEEP_MS) await sleep(SLEEP_MS); // gentle on rate limits
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(out));
  const mb = (fs.statSync(OUT_PATH).size / 1e6).toFixed(2);
  console.log(`\nWrote ${out.length} embedded chunks -> ${OUT_PATH} (${mb} MB)`);
}

main();
