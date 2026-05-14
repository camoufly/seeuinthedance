/**
 * DELETE /api/delete-artifact
 * Body: { id }
 * Removes artifact with given id from ARTIFACTS array in index.html via GitHub API
 */
export default async function handler(req, res) {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-artifact-secret'];
  if (!secret || secret !== process.env.ADD_ARTIFACT_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Missing id' });

  const repo  = process.env.GITHUB_REPO;
  const token = process.env.GITHUB_TOKEN;

  // Get current index.html
  const ghRes = await fetch(`https://api.github.com/repos/${repo}/contents/index.html`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });
  if (!ghRes.ok) return res.status(500).json({ error: 'GitHub fetch failed' });

  const { content, sha } = await ghRes.json();
  const html = Buffer.from(content, 'base64').toString('utf8');

  // Remove the artifact line with matching id
  const lineRegex = new RegExp(`\\s*\\{\\s*id:'${id}',[^}]+\\},?\\n?`, 'g');
  const updated = html.replace(lineRegex, '\n  ');

  if (updated === html) return res.status(404).json({ error: 'Artifact not found' });

  // Push updated index.html
  const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/index.html`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: `delete artifact #${id}`,
      content: Buffer.from(updated).toString('base64'),
      sha,
    }),
  });

  if (!putRes.ok) {
    const text = await putRes.text();
    return res.status(500).json({ error: text });
  }

  return res.status(200).json({ ok: true });
}