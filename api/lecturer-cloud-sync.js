import { db } from "hatchable";

export const access = "public";
export const methods = ["GET", "PUT", "OPTIONS"];
const AUTH_URL = "https://lecturer-attendance.hatchable.site/api/lecturer-auth";
const ALLOWED_ORIGINS = new Set([
  "https://offline-qr.hatchable.site",
  "https://lecturer-offline-qr.web.app"
]);

function cors(req, res) {
  const origin = req.headers?.origin || "";
  if (ALLOWED_ORIGINS.has(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store");
}

async function lecturerFromToken(req) {
  const h = req.headers?.authorization || "";
  if (!h.startsWith("Bearer ")) return null;
  const token = h.slice(7).trim();
  if (!token || token.length > 300) return null;
  const r = await fetch(AUTH_URL, {
    method: "GET",
    headers: { Authorization: "Bearer " + token, "Cache-Control": "no-store" }
  });
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  if (!d?.ok || !d?.lecturer?.lecturerId || d.mustChangePassword) return null;
  return d.lecturer;
}

function itemKey(value) {
  return String(value ?? "").trim().toUpperCase();
}

async function loadLecturerSnapshot(lecturerId) {
  const [sessionsResult, recordsResult, rosterResult] = await Promise.all([
    db.query(
      "SELECT session_data AS item FROM lecturer_attendance_sessions WHERE lecturer_id = $1 ORDER BY updated_at ASC",
      [lecturerId]
    ),
    db.query(
      "SELECT record_data AS item FROM lecturer_attendance_records WHERE lecturer_id = $1 ORDER BY updated_at ASC",
      [lecturerId]
    ),
    db.query(
      "SELECT roster_data AS item FROM lecturer_attendance_roster WHERE lecturer_id = $1 ORDER BY updated_at ASC",
      [lecturerId]
    )
  ]);
  return {
    sessions: sessionsResult.rows.map(row => row.item),
    records: recordsResult.rows.map(row => row.item),
    roster: rosterResult.rows.map(row => row.item),
    schemaVersion: 2
  };
}

export default async function(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET" && req.method !== "PUT") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  let lecturer;
  try {
    lecturer = await lecturerFromToken(req);
  } catch (e) {
    return res.status(503).json({ error: "Could not verify your lecturer account. Try again when online." });
  }
  if (!lecturer) return res.status(401).json({ error: "Sign in online to sync your attendance data." });

  // Ownership always comes from the verified auth token, never the request body.
  const owner = String(lecturer.lecturerId).trim().toUpperCase();

  try {
    if (req.method === "GET") {
      const snapshot = await loadLecturerSnapshot(owner);
      const latest = await db.query(
        "SELECT GREATEST(COALESCE((SELECT max(updated_at) FROM lecturer_attendance_sessions WHERE lecturer_id = $1), 'epoch'::timestamptz), COALESCE((SELECT max(updated_at) FROM lecturer_attendance_records WHERE lecturer_id = $1), 'epoch'::timestamptz), COALESCE((SELECT max(updated_at) FROM lecturer_attendance_roster WHERE lecturer_id = $1), 'epoch'::timestamptz)) AS updated_at",
        [owner]
      );
      return res.json({ ok: true, snapshot, updatedAt: latest.rows[0]?.updated_at || null });
    }

    const body = req.body || {};
    const snapshot = body.snapshot;
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return res.status(400).json({ error: "A valid attendance snapshot is required." });
    }
    const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
    const records = Array.isArray(snapshot.records) ? snapshot.records : [];
    const roster = Array.isArray(snapshot.roster) ? snapshot.roster : [];
    if (sessions.length > 20000 || records.length > 100000 || roster.length > 100000) {
      return res.status(413).json({ error: "The attendance dataset is too large to sync in one request." });
    }

    // Bulk upserts keep sync efficient for large classes. Rows are scoped by the
    // authenticated lecturer ID, and partial/stale browser snapshots never delete rows.
    await db.query(
      "INSERT INTO lecturer_attendance_sessions (lecturer_id, session_id, session_data, updated_at) SELECT $1, item->>'sessionId', item, now() FROM jsonb_array_elements($2::jsonb) AS items(item) WHERE NULLIF(trim(item->>'sessionId'), '') IS NOT NULL ON CONFLICT (lecturer_id, session_id) DO UPDATE SET session_data = lecturer_attendance_sessions.session_data || EXCLUDED.session_data, updated_at = now()",
      [owner, JSON.stringify(sessions)]
    );
    await db.query(
      "INSERT INTO lecturer_attendance_records (lecturer_id, session_id, student_id, record_data, updated_at) SELECT $1, item->>'sessionId', upper(trim(item->>'studentId')), item, now() FROM jsonb_array_elements($2::jsonb) AS items(item) WHERE NULLIF(trim(item->>'sessionId'), '') IS NOT NULL AND NULLIF(trim(item->>'studentId'), '') IS NOT NULL ON CONFLICT (lecturer_id, session_id, student_id) DO UPDATE SET record_data = lecturer_attendance_records.record_data || EXCLUDED.record_data, updated_at = now()",
      [owner, JSON.stringify(records)]
    );
    await db.query(
      "INSERT INTO lecturer_attendance_roster (lecturer_id, student_id, roster_data, updated_at) SELECT $1, upper(trim(item->>'studentId')), item, now() FROM jsonb_array_elements($2::jsonb) AS items(item) WHERE NULLIF(trim(item->>'studentId'), '') IS NOT NULL ON CONFLICT (lecturer_id, student_id) DO UPDATE SET roster_data = lecturer_attendance_roster.roster_data || EXCLUDED.roster_data, updated_at = now()",
      [owner, JSON.stringify(roster)]
    );

    const saved = await loadLecturerSnapshot(owner);
    return res.json({
      ok: true,
      schemaVersion: 2,
      sessions: saved.sessions.length,
      records: saved.records.length,
      roster: saved.roster.length,
      updatedAt: Date.now()
    });
  } catch (e) {
    console.error("Lecturer attendance database sync failed", e);
    return res.status(500).json({ error: "Could not save attendance to the lecturer database. Please retry sync." });
  }
}