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
  const r = await fetch(AUTH_URL, { method: "GET", headers: { Authorization: "Bearer " + token, "Cache-Control": "no-store" } });
  if (!r.ok) return null;
  const d = await r.json().catch(() => null);
  if (!d?.ok || !d?.lecturer?.lecturerId || d.mustChangePassword) return null;
  return d.lecturer;
}
export default async function(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "GET" && req.method !== "PUT") return res.status(405).json({ error: "Method not allowed." });
  let lecturer;
  try { lecturer = await lecturerFromToken(req); }
  catch (e) { return res.status(503).json({ error: "Could not verify your lecturer account. Try again when online." }); }
  if (!lecturer) return res.status(401).json({ error: "Sign in online to sync your attendance data." });
  const owner = String(lecturer.lecturerId).toUpperCase();
  if (req.method === "GET") {
    const result = await db.query("SELECT snapshot, updated_at FROM lecturer_attendance_snapshots WHERE lecturer_id = $1", [owner]);
    return res.json({ ok: true, snapshot: result.rows[0]?.snapshot || null, updatedAt: result.rows[0]?.updated_at || null });
  }
  const body = req.body || {};
  const snapshot = body.snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return res.status(400).json({ error: "A valid attendance snapshot is required." });
  const sessions = Array.isArray(snapshot.sessions) ? snapshot.sessions : [];
  const records = Array.isArray(snapshot.records) ? snapshot.records : [];
  const roster = Array.isArray(snapshot.roster) ? snapshot.roster : [];
  if (sessions.length > 20000 || records.length > 100000 || roster.length > 100000) return res.status(413).json({ error: "The attendance dataset is too large to sync in one request." });
  // Attendance is append-preserving across devices: never let a stale browser snapshot
  // erase sessions or records that were already synced by another device.
  const existingResult = await db.query("SELECT snapshot FROM lecturer_attendance_snapshots WHERE lecturer_id = $1", [owner]);
  const existing = existingResult.rows[0]?.snapshot || {};
  const merge = (oldItems, newItems, keyFn) => {
    const map = new Map();
    for (const item of [...(Array.isArray(oldItems) ? oldItems : []), ...(Array.isArray(newItems) ? newItems : [])]) {
      const key = keyFn(item);
      if (key) map.set(key, { ...(map.get(key) || {}), ...item });
    }
    return Array.from(map.values());
  };
  const mergedSessions = merge(existing.sessions, sessions, x => x?.sessionId);
  const mergedRecords = merge(existing.records, records, x => x?.sessionId && x?.studentId ? String(x.sessionId) + "|" + String(x.studentId).trim().toUpperCase() : "");
  const mergedRoster = merge(existing.roster, roster, x => x?.studentId ? String(x.studentId).trim().toUpperCase() : "");
  const clean = { sessions: mergedSessions, records: mergedRecords, roster: mergedRoster, schemaVersion: 1, savedAt: Date.now() };
  await db.query(
    "INSERT INTO lecturer_attendance_snapshots (lecturer_id, snapshot, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (lecturer_id) DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = now()",
    [owner, JSON.stringify(clean)]
  );
  return res.json({ ok: true, updatedAt: Date.now(), sessions: mergedSessions.length, records: mergedRecords.length, roster: mergedRoster.length });
}
