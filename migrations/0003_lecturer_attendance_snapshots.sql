CREATE TABLE IF NOT EXISTS lecturer_attendance_snapshots (
  lecturer_id TEXT PRIMARY KEY,
  snapshot JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);