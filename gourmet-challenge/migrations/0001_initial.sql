CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  voting_open INTEGER NOT NULL DEFAULT 1 CHECK (voting_open IN (0, 1)),
  results_visible INTEGER NOT NULL DEFAULT 1 CHECK (results_visible IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  is_chef INTEGER NOT NULL DEFAULT 0 CHECK (is_chef IN (0, 1)),
  course TEXT,
  code_hash TEXT NOT NULL UNIQUE,
  CHECK ((is_chef = 1 AND course IS NOT NULL AND length(course) > 0) OR
         (is_chef = 0 AND course IS NULL))
);

CREATE TABLE IF NOT EXISTS votes (
  judge_id TEXT NOT NULL REFERENCES participants(id),
  chef_id TEXT NOT NULL REFERENCES participants(id),
  taste INTEGER NOT NULL CHECK (taste BETWEEN 1 AND 10),
  presentation INTEGER NOT NULL CHECK (presentation BETWEEN 1 AND 10),
  creativity INTEGER NOT NULL CHECK (creativity BETWEEN 1 AND 10),
  pairing INTEGER NOT NULL CHECK (pairing BETWEEN 1 AND 10),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (judge_id, chef_id),
  CHECK (judge_id <> chef_id)
);
CREATE INDEX IF NOT EXISTS votes_by_chef ON votes(chef_id);
