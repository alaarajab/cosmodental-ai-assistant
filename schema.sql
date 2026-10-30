-- Documents uploaded by clinic staff (clinic documents only, never patient records)
CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  filename    TEXT NOT NULL,
  lang        TEXT NOT NULL DEFAULT 'en',
  namespace   TEXT NOT NULL DEFAULT 'live',   -- 'live' or 'exp-...' (experiments)
  chunk_max   INTEGER NOT NULL DEFAULT 800,
  chunk_overlap INTEGER NOT NULL DEFAULT 150,
  pages       INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Chunk text lives here; Vectorize only stores the vector + id.
CREATE TABLE IF NOT EXISTS chunks (
  id      TEXT PRIMARY KEY,          -- "<docId>-<index>", same id as in Vectorize
  doc_id  TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  idx     INTEGER NOT NULL,
  page    INTEGER NOT NULL,
  text    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_id);
CREATE INDEX IF NOT EXISTS documents_ns ON documents(namespace);

-- Anonymous question log (emails/phone numbers are redacted before saving)
CREATE TABLE IF NOT EXISTS questions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  question   TEXT NOT NULL,
  lang       TEXT NOT NULL,
  answered   INTEGER NOT NULL,        -- 1 = answered from documents, 0 = fallback
  top_score  REAL,
  latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
