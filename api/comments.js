/**
 * /api/comments.js
 * GET  /api/comments?id=001       → returns comments array for artifact
 * POST /api/comments              → body: { id, text } → saves comment, returns updated array
 *
 * Requires Vercel env vars:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * Install dependency:
 *   npm install @upstash/redis
 */

import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const MAX_COMMENTS = 200; // max per artifact
const MAX_LENGTH   = 280;

// Basic filter list — duplicated here as server-side safety net
const BAD_WORDS = ['spam','fuck','shit','cunt','nigger','nazi','kys','kill yourself','hate','asshole'];
function isBad(text) {
  const lower = text.toLowerCase();
  return BAD_WORDS.some(w => lower.includes(w));
}

function key(id) {
  return `archive:comments:${id}`;
}

export default async function handler(req, res) {
  // ── CORS (optional, restrict to your domain in production) ──
  res.setHeader('Access-Control-Allow-Origin', 'https://seeuinthe.dance');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET ──────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const raw = await redis.lrange(key(id), 0, -1);
    const comments = raw.map(r => (typeof r === 'string' ? JSON.parse(r) : r));
    return res.status(200).json({ comments });
  }

  // ── POST ─────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const { id, text } = req.body || {};

    if (!id || typeof id !== 'string')   return res.status(400).json({ error: 'Missing id' });
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Missing text' });
    if (text.length > MAX_LENGTH)         return res.status(400).json({ error: 'Too long' });
    if (isBad(text))                      return res.status(400).json({ error: 'Rejected' });

    const entry = JSON.stringify({ text: text.trim(), ts: Date.now() });
    const k = key(id);

    await redis.rpush(k, entry);
    // Trim to max
    await redis.ltrim(k, -MAX_COMMENTS, -1);

    const raw = await redis.lrange(k, 0, -1);
    const comments = raw.map(r => (typeof r === 'string' ? JSON.parse(r) : r));
    return res.status(200).json({ comments });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}