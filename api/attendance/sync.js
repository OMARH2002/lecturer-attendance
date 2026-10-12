import { db } from 'hatchable';

export const access = 'member';
export const methods = ['GET', 'POST'];

function sessionOut(row) {
  return {
    sessionId: row.session_id,
    course: row.course,
    department: row.department,
    group: row.group_name,
    createdAt: Number(row.created_at_ms),
    expiresAt: Number(row.expires_at_ms),
    type: 'offline-attendance-session'
  };
}

function recordOut(row) {
  return {
    sessionId: row.session_id,
    course: row.course,
    department: row.department,
    group: row.group_name,
    studentId: row.student_id,
    name: row.student_name,
    studentDepartment: row.student_department,
    deviceToken: row.device_token,
    submittedAt: Number(row.submitted_at_ms),
    scannedAt: Number(row.scanned_at_ms),
    validation: row.validation
  };
}

async function snapshot(ownerId) {
  const sessions = await db.query(
    'SELECT session_id, course, department, group_name, created_at_ms, expires_at_ms FROM attendance_sync_sessions WHERE owner_id = $1 ORDER BY created_at_ms DESC LIMIT 1000',
    [ownerId]
  );
  const records = await db.query(
    'SELECT session_id, course, department, group_name, student_id, student_name, student_department, device_token, submitted_at_ms, scanned_at_ms, validation FROM attendance_sync_records WHERE owner_id = $1 ORDER BY scanned_at_ms DESC LIMIT 10000',
    [ownerId]
  );
  return { sessions: sessions.rows.map(sessionOut), records: records.rows.map(recordOut) };
}

export default async function (req, res) {
  const ownerId = String(req.member.id);
  if (req.method === 'GET') {
    return res.json({ ok: true, ...(await snapshot(ownerId)) });
  }

  const body = req.body || {};
  const sessions = Array.isArray(body.sessions) ? body.sessions.slice(0, 1000) : [];
  const records = Array.isArray(body.records) ? body.records.slice(0, 1000) : [];
  // Empty local arrays are valid: this device may be pulling an existing cloud snapshot.

  for (const s of sessions) {
    if (!s || !s.sessionId || !s.course || !s.department || !s.group) continue;
    await db.query(
      'INSERT INTO attendance_sync_sessions (owner_id, session_id, course, department, group_name, created_at_ms, expires_at_ms, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (owner_id, session_id) DO UPDATE SET course=EXCLUDED.course, department=EXCLUDED.department, group_name=EXCLUDED.group_name, expires_at_ms=EXCLUDED.expires_at_ms, updated_at=now()',
      [ownerId, String(s.sessionId), String(s.course), String(s.department), String(s.group), Number(s.createdAt) || Date.now(), Number(s.expiresAt) || Date.now()]
    );
  }

  for (const r of records) {
    if (!r || !r.sessionId || !r.studentId || !r.name || !r.course) continue;
    await db.query(
      'INSERT INTO attendance_sync_records (owner_id, session_id, course, department, group_name, student_id, student_name, student_department, device_token, submitted_at_ms, scanned_at_ms, validation, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()) ON CONFLICT (owner_id, session_id, student_id) DO NOTHING',
      [ownerId, String(r.sessionId), String(r.course), String(r.department || ''), String(r.group || ''), String(r.studentId), String(r.name), String(r.studentDepartment || ''), String(r.deviceToken || ''), Number(r.submittedAt) || Date.now(), Number(r.scannedAt) || Number(r.submittedAt) || Date.now(), String(r.validation || '')]
    );
  }

  return res.json({ ok: true, ...(await snapshot(ownerId)) });
}