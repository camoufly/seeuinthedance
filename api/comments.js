import { Redis } from '@upstash/redis';
import { Filter } from 'bad-words';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const filter = new Filter();
const MAX_COMMENTS = 200;
const MAX_LENGTH   = 280;

function key(id) {
  return `archive:comments:${id}`;
}

async function isSpam(text, userIp, userAgent) {
  const apiKey  = process.env.AKISMET_API_KEY;
  const siteUrl = process.env.AKISMET_SITE_URL;

  const params = new URLSearchParams({
    blog:            siteUrl,
    user_ip:         userIp || '127.0.0.1',
    user_agent:      userAgent || '',
    comment_type:    'comment',
    comment_content: text,
  });

  const res = await fetch(`https://${apiKey}.rest.akismet.com/1.1/comment-check`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    params.toString(),
  });

  const body = await res.text();
  return body.trim() === 'true';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://seeuinthe.dance');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET
  if (req.method === 'GET') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    const raw = await redis.lrange(key(id), 0, -1);
    const comments = raw.map(r => (typeof r === 'string' ? JSON.parse(r) : r));
    return res.status(200).json({ comments });
  }

  // POST
  if (req.method === 'POST') {
    const { id, text } = req.body || {};
    if (!id || typeof id !== 'string')     return res.status(400).json({ error: 'Missing id' });
    if (!text || typeof text !== 'string') return res.status(400).json({ error: 'Missing text' });
    if (text.length > MAX_LENGTH)          return res.status(400).json({ error: 'Too long' });

    // bad-words check
    if (filter.isProfane(text)) {
      return res.status(400).json({ error: 'Rejected' });
    }

    const userIp    = req.headers['x-forwarded-for']?.split(',')[0] || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';

    // Akismet spam check
    try {
      const spam = await isSpam(text, userIp, userAgent);
      if (spam) {
        const raw = await redis.lrange(key(id), 0, -1);
        const comments = raw.map(r => (typeof r === 'string' ? JSON.parse(r) : r));
        return res.status(200).json({ comments });
      }
    } catch (err) {
      console.error('Akismet error:', err);
    }

    const entry = JSON.stringify({ text: text.trim(), ts: Date.now() });
    await redis.rpush(key(id), entry);
    await redis.ltrim(key(id), -MAX_COMMENTS, -1);

    const raw = await redis.lrange(key(id), 0, -1);
    const comments = raw.map(r => (typeof r === 'string' ? JSON.parse(r) : r));
    return res.status(200).json({ comments });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}