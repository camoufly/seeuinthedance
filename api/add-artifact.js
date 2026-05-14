/**
 * /api/add-artifact.js
 * POST { title, date, type, src?, file?, filename?, mimetype? }
 * - If type is video-mp4 or audio-mp3: expects base64 file + filename + mimetype
 * - If type is video-embed or audio-embed: expects src URL
 * Updates ARTIFACTS array in index.html via GitHub API and triggers redeploy
 *
 * Env vars needed:
 *   GITHUB_TOKEN, GITHUB_REPO
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET
 *   ADD_ARTIFACT_SECRET (a secret you set to protect this endpoint)
 */

import crypto from 'crypto';

// ── S3/R2 signing (AWS Signature V4) ────────────────────────
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function hmacHex(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest('hex');
}

async function uploadToR2(fileBuffer, filename, mimetype) {
  const endpoint = process.env.R2_ENDPOINT; // e.g. https://ACCOUNTID.r2.cloudflarestorage.com
  const bucket   = process.env.R2_BUCKET;
  const accessKey = process.env.R2_ACCESS_KEY_ID;
  const secretKey = process.env.R2_SECRET_ACCESS_KEY;

  const url = new URL(`/${bucket}/${filename}`, endpoint);
  const host = url.host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';

  const payloadHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    `/${bucket}/${filename}`,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretKey}`, dateStamp), region), service),
    'aws4_request'
  );
  const signature = hmacHex(signingKey, stringToSign);

  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(url.toString(), {
    method: 'PUT',
    headers: {
      'Content-Type': mimetype,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      'Authorization': authorization,
    },
    body: fileBuffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`R2 upload failed: ${res.status} ${text}`);
  }

  const publicUrl = process.env.R2_PUBLIC_URL || `${endpoint}/${bucket}`;
  return `${publicUrl}/${filename}`;
}

// ── GitHub API ───────────────────────────────────────────────
async function getIndexFile() {
  const repo  = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/index.html`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });
  if (!res.ok) throw new Error(`GitHub GET failed: ${res.status}`);
  return res.json(); // { content (base64), sha }
}

async function updateIndexFile(content, sha, commitMessage) {
  const repo  = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/index.html`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: commitMessage,
      content: Buffer.from(content).toString('base64'),
      sha,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub PUT failed: ${res.status} ${text}`);
  }
  return res.json();
}

function injectArtifact(htmlContent, artifact) {
  // Find the closing ]; of the ARTIFACTS array and inject before it
  const marker = 'const ARTIFACTS = [';
  const startIdx = htmlContent.indexOf(marker);
  if (startIdx === -1) throw new Error('ARTIFACTS array not found in index.html');

  // Find the closing ]; after the array start
  const closingIdx = htmlContent.indexOf('];', startIdx);
  if (closingIdx === -1) throw new Error('ARTIFACTS array closing not found');

  // Build new entry
  const entry = `  { id:'${artifact.id}', title:'${artifact.title}', date:'${artifact.date}', type:'${artifact.type}', src:'${artifact.src}', download:${artifact.download ? `'${artifact.download}'` : 'null'} },
  `;

  return htmlContent.slice(0, closingIdx) + entry + htmlContent.slice(closingIdx);
}

function getNextId(htmlContent) {
  const matches = [...htmlContent.matchAll(/id:'(\d+)'/g)];
  if (!matches.length) return '001';
  const max = Math.max(...matches.map(m => parseInt(m[1], 10)));
  return String(max + 1).padStart(3, '0');
}

// ── Handler ──────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth check
  const secret = req.headers['x-artifact-secret'];
  if (!secret || secret !== process.env.ADD_ARTIFACT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { title, date, type, src, file, filename, mimetype, download } = req.body || {};

  if (!title || !date || !type) return res.status(400).json({ error: 'Missing fields' });

  let mediaSrc = src;
  let downloadUrl = download || null;

  // If file upload (base64)
  if (file && filename && mimetype) {
    const buffer = Buffer.from(file, 'base64');
    const r2Url = await uploadToR2(buffer, filename, mimetype);
    mediaSrc = r2Url;
    if (type === 'audio-mp3' || type === 'video-mp4') {
      downloadUrl = r2Url;
    }
  }

  if (!mediaSrc) return res.status(400).json({ error: 'Missing src or file' });

  // Get current index.html from GitHub
  const { content: encodedContent, sha } = await getIndexFile();
  const htmlContent = Buffer.from(encodedContent, 'base64').toString('utf8');

  const id = getNextId(htmlContent);
  const artifact = { id, title, date, type, src: mediaSrc, download: downloadUrl };

  const updatedHtml = injectArtifact(htmlContent, artifact);
  await updateIndexFile(updatedHtml, sha, `add artifact #${id}: ${title}`);

  return res.status(200).json({ ok: true, id, artifact });
}