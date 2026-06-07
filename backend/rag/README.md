# STW Guideline RAG

Grounds the **prescription** stage of the clinical pipeline in the ICMR
Standard Treatment Workflows (STW) so the model cites real, verifiable passages
instead of fabricating sources ("ghost citations").

## How it works

```
source_docs/*.pdf  ──(extract_pdf.py)──►  data/chunks.json
                                              │
                                              ▼  (ingest.js, Gemini embeddings)
                              data/guidelines.embeddings.json
                                              │
                                              ▼  (loaded in-memory at runtime)
   generatePrescription()  ──retrieve(diagnosisText)──►  top-K STW passages
                                              │
                                              ▼
        injected into the prompt as the ONLY citable sources [G1]..[G5]
```

- **Storage: in-memory.** The corpus is static and tiny (163 page-level chunks,
  ~7.5 MB of 3072-dim vectors), so the whole index loads into RAM once and a
  brute-force cosine scan is sub-millisecond. No SQLite/pgvector, no native deps,
  no DB lifecycle. (`src/services/rag/retriever.js`)
- **Chunking: one chunk per PDF page.** Each STW page is a self-contained
  condition workflow; this avoids the scrambled intra-page reading order of the
  infographic layout. Each chunk carries a citation label like
  `ICMR STW of India — Vol III (2022) — Dermatophytoses (ICD-10-B35.9), p.14`.
- **Integration point: the prescription stage** (`geminiService.generatePrescription`),
  where dosing/referral advice and ghost citations both live. The retrieval
  query is the 2Diagnosis output (provisional + differential diagnoses).
- **Ghost-citation guard:** the model may only cite the provided `[G#]` tags;
  any `[G#]` it invents that wasn't retrieved is stripped post-generation
  (`resolveCitations`).

## Rebuilding the index

Run whenever the PDFs in `source_docs/` change. Requires `GEMINI_API_KEY`
(in `backend/.env` or the environment) and `pip install pypdf`.

```bash
cd backend
npm run rag:extract   # PDFs -> data/chunks.json   (no API key needed)
npm run rag:ingest    # chunks.json -> data/guidelines.embeddings.json
```

If `guidelines.embeddings.json` is absent at runtime, retrieval safely no-ops
and the prescription stage falls back to ungrounded behaviour (logged as
`[RAG] guideline index not found`).

## Tunables (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `RAG_TOP_K` | 5 | passages injected per prescription |
| `RAG_MIN_SCORE` | 0.55 | min cosine similarity to include |
| `GEMINI_EMBED_MODEL` | gemini-embedding-001 | embedding model (3072-dim) |
| `RAG_INGEST_SLEEP_MS` | 150 | delay between embed calls during ingest |

> Note: `source_docs/` holds ~80 MB of PDFs. If repo size matters, move them to
> Git LFS or drop them from the repo (only `data/guidelines.embeddings.json` is
> needed at runtime; the PDFs are only needed to rebuild the index).
