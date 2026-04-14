export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body;

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Missing password' });
  }

  // Aggiungi qui le tue password → URL
  // Le password sono visibili, gli URL vivono solo su Vercel env vars
  const map = {
    'camoufly': process.env.PWD_CAMOUFLY,
  };


  const url = map[password.trim().toLowerCase()];

  if (url) {
    return res.status(200).json({ url });
  } else {
    return res.status(401).json({ error: 'Invalid password' });
  }
}
