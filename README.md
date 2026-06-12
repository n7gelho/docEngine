# Aircraft Deal Document Engine

Ingestion engine for **purchase** and **lease** aircraft deal documents (**LOIs** and **OLAs**). Upload PDF or DOCX contracts, extract structured metadata, filter by contract facts, and link corresponding LOIs to OLAs within the same deal type.

## Features

- **Ingestion** — Upload PDF/DOCX individually or ingest a folder of deal documents
- **Deal classification** — Purchase vs Lease, with LOI/OLA document role detection (including common alternative titles)
- **Metadata extraction** — Profile-based LOI (7 fields) and OLA (9 sections, 35 fields) via local Ollama or optional OpenAI
- **Metadata filters** — Filter by deal type, document type, parties, aircraft, jurisdiction, and OLA section fields
- **LOI ↔ OLA linking** — Auto-match and manually link LOIs and OLAs (same deal type only)
- **Paginated library** — Browse documents 20 per page at `/documents`
- **Semantic search** — Available at `/search` (embeddings generated on ingest)

## Stack

- Next.js 15 (App Router), React, Tailwind CSS
- PostgreSQL + pgvector
- Drizzle ORM
- **Ollama** (local LLM + embeddings, recommended) or OpenAI (optional cloud fallback)

## Prerequisites

- Node.js 20+
- Docker (PostgreSQL)
- Ollama desktop app (recommended) — must be running before upload; do not run `ollama serve` if the app is already up

## Quick start

### 1. Start PostgreSQL

```bash
docker compose up -d
```

### 2. Ollama (recommended)

Install from [ollama.com/download](https://ollama.com/download), then:

```bash
ollama pull llama3:latest
ollama pull nomic-embed-text
```

Verify: `ollama list`

### 3. Configure environment

```bash
cp .env.example .env.local
```

Key variables:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection (default works with Docker Compose) |
| `AI_PROVIDER=auto` | Ollama first, then OpenAI, then heuristic fallback |
| `EXTRACTION_MAX_PAGES=3` | Pages sent to LLM for LOI / OLA header extraction |
| `EXTRACTION_SCAN_PAGES=25` | Pages scanned to skip cover/TOC |
| `EMBEDDING_DIMENSIONS=768` | For `nomic-embed-text` |

### 4. Install and run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How it works

```
Upload (PDF/DOCX)
  → Parse text + pages
  → Classify: dealType (PURCHASE|LEASE) + documentType (LOI|OLA) from document header + filename
  → Extract metadata (Ollama / OpenAI / heuristic)
  → Chunk full document + embed (pgvector)
  → Store in PostgreSQL
  → Auto-link LOI ↔ OLA pairs
```

**LOI extraction** — One LLM pass on the top 3 metadata-rich pages. Extracts 7 flat fields (counterparty, aircraft, MSN, term, jurisdiction, governing law, indicative value).

**OLA extraction** — Multi-pass pipeline:
1. **Tier-1 header** — Core pages → parties, aircraft, MSN, governing law
2. **Section passes** — Locate 9 contract sections (regex + keyword fallback), run parallel LLM calls per section with flat JSON output
3. **Coverage** — Stored in `metadata._extraction_coverage` (fields filled, sections located, warnings)

**AI fallback chain** (`AI_PROVIDER=auto`): Ollama → OpenAI (if configured) → regex heuristic.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/documents` | List/filter documents (`limit`, `offset`, `dealType`, …) |
| `POST` | `/api/documents` | Upload document |
| `GET` | `/api/documents/:id` | Get document detail |
| `DELETE` | `/api/documents/:id` | Delete document |
| `POST` | `/api/documents/:id/reprocess` | Re-run ingestion pipeline |
| `POST` | `/api/documents/:id/similar` | Find similar documents |
| `GET/POST/DELETE` | `/api/documents/:id/related` | LOI/OLA deal links |

## Project structure

```
src/
  app/                      # Pages: / (upload), /documents, /documents/[id], /search
  components/               # UploadPanel, DocumentList, MetadataFilters, …
  lib/
    extraction/             # LOI/OLA extraction pipeline (see index.ts)
      index.ts                # Public exports for new features
      classify-document.ts    # Header-based LOI/OLA + deal type detection
      extract-metadata.ts     # LOI extraction
      extract-ola.ts          # OLA multi-pass extraction
      llm-json.ts             # Shared Ollama/OpenAI JSON calls
      normalize-extraction.ts
      ola-section-windows.ts  # Section location in long OLAs
      prompt.ts
      map-extraction-fields.ts
    ingestion/                # Upload + processDocument pipeline
    deals/                    # LOI↔OLA linking
    search/                   # List, filter, semantic search
scripts/
  reprocess-all.ts            # Re-run extraction on all documents
  load-env.ts
uploads/                      # Stored documents (gitignored)
```

## Maintenance scripts

```bash
npm run reprocess:all          # Re-run extraction on all documents
npm run reprocess:ola          # OLAs only (verbose field output)
npx tsx scripts/reprocess.ts id:<uuid>   # Single document

npx tsx scripts/diagnostics.ts classification [limit]   # LOI/OLA classification check
npx tsx scripts/diagnostics.ts metadata [--ola]         # Stored metadata + coverage
npx tsx scripts/diagnostics.ts ola-sections [docId]     # OLA section locator preview
```
