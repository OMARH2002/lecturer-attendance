CREATE TABLE attendance_sync_sessions (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  course TEXT NOT NULL,
  department TEXT NOT NULL,
  group_name TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL,
  expires_at_ms BIGINT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (owner_id, session_id)
);

CREATE INDEX idx_attendance_sync_sessions_owner ON attendance_sync_sessions(owner_id);

CREATE TABLE attendance_sync_records (
  id BIGSERIAL PRIMARY KEY,
  owner_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  course TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  student_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  student_department TEXT NOT NULL DEFAULT '',
  device_token TEXT NOT NULL DEFAULT '',
  submitted_at_ms BIGINT NOT NULL,
  scanned_at_ms BIGINT NOT NULL,
  validation TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (owner_id, session_id, student_id)
);

CREATE INDEX idx_attendance_sync_records_owner ON attendance_sync_records(owner_id);
CREATE INDEX idx_attendance_sync_records_session ON attendance_sync_records(owner_id, session_id);