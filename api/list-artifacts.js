/**
 * GET /api/list-artifacts
 * Returns the current ARTIFACTS array from index.html via GitHub API
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-artifact-secret'];
  if (!secret || secret !== process.env.ADD_ARTIFACT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const repo  = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  const ghRes = await fetch(`https://api.github.com/repos/${repo}/contents/index.html`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!ghRes.ok) return res.status(500).json({ error: 'GitHub fetch failed' });

  const { content } = await ghRes.json();
  const html = Buffer.from(content, 'base64').toString('utf8');

  // Extract ARTIFACTS array content
  const match = html.match(/const ARTIFACTS = \[([\s\S]*?)\];/);
  if (!match) return res.status(500).json({ error: 'ARTIFACTS not found' });

  // Parse each artifact entry
  const artifacts = [];
  const entryRegex = /\{\s*id:'([^']+)',\s*title:'([^']+)',\s*date:'([^']+)',\s*type:'([^']+)',\s*src:'([^']*)',\s*download:(null|'[^']*')\s*\}/g;
  let m;
  while ((m = entryRegex.exec(match[1])) !== null) {
    artifacts.push({
      id:       m[1],
      title:    m[2],
      date:     m[3],
      type:     m[4],
      src:      m[5],
      download: m[6] === 'null' ? null : m[6].replace(/'/g, ''),
    });
  }

  return res.status(200).json({ artifacts });
}