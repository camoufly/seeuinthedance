/**
 * /api/unlock.js
 * POST { password } → { ok: true } on success (frontend handles navigation)
 *
 * Env vars:
 *   ARCHIVE_PASSWORD   — the single access password (or extend the map for multiple)
 */

export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body;

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Missing password' });
  }

  // Single password → archive access
  // Extend to a map if you want multiple passwords with different destinations
  const valid = password.trim().toLowerCase() === (process.env.ARCHIVE_PASSWORD || '').toLowerCase();

  if (valid) {
    return res.status(200).json({ ok: true });
  } else {
    return res.status(401).json({ error: 'Invalid password' });
  }
}