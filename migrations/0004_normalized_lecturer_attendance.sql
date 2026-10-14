-- Normalize lecturer attendance into per-lecturer relational tables.
-- Keep lecturer_attendance_snapshots as a legacy archive; do not delete or rewrite it.
CREATE TABLE IF NOT EXISTS lecturer_attendance_sessions (
  lecturer_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  session_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lecturer_id, session_id)
);
CREATE INDEX IF NOT EXISTS lecturer_attendance_sessions_lecturer_updated_idx
  ON lecturer_attendance_sessions (lecturer_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS lecturer_attendance_records (
  lecturer_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  record_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lecturer_id, session_id, student_id)
);
CREATE INDEX IF NOT EXISTS lecturer_attendance_records_lecturer_session_idx
  ON lecturer_attendance_records (lecturer_id, session_id);

CREATE TABLE IF NOT EXISTS lecturer_attendance_roster (
  lecturer_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  roster_data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lecturer_id, student_id)
);

-- One-time, non-destructive backfill from the existing JSONB snapshot.
INSERT INTO lecturer_attendance_sessions (lecturer_id, session_id, session_data, updated_at)
SELECT s.lecturer_id, item->>'sessionId', item, s.updated_at
FROM lecturer_attendance_snapshots s
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(s.snapshot->'sessions') = 'array' THEN s.snapshot->'sessions' ELSE '[]'::jsonb END
) AS items(item)
WHERE NULLIF(item->>'sessionId', '') IS NOT NULL
ON CONFLICT (lecturer_id, session_id) DO NOTHING;

INSERT INTO lecturer_attendance_records (lecturer_id, session_id, student_id, record_data, updated_at)
SELECT s.lecturer_id, item->>'sessionId', upper(trim(item->>'studentId')), item, s.updated_at
FROM lecturer_attendance_snapshots s
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(s.snapshot->'records') = 'array' THEN s.snapshot->'records' ELSE '[]'::jsonb END
) AS items(item)
WHERE NULLIF(item->>'sessionId', '') IS NOT NULL
  AND NULLIF(trim(item->>'studentId'), '') IS NOT NULL
ON CONFLICT (lecturer_id, session_id, student_id) DO NOTHING;

INSERT INTO lecturer_attendance_roster (lecturer_id, student_id, roster_data, updated_at)
SELECT s.lecturer_id, upper(trim(item->>'studentId')), item, s.updated_at
FROM lecturer_attendance_snapshots s
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(s.snapshot->'roster') = 'array' THEN s.snapshot->'roster' ELSE '[]'::jsonb END
) AS items(item)
WHERE NULLIF(trim(item->>'studentId'), '') IS NOT NULL
ON CONFLICT (lecturer_id, student_id) DO NOTHING;