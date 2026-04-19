// api/submit-review.js — Recibe reseñas con rate limiting por IP
const https = require('https');
const { checkRateLimit, getIP } = require('./_rateLimit');

const FIREBASE_URL    = process.env.FIREBASE_URL || 'https://ufobikeshop-default-rtdb.firebaseio.com';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://ufo-bikeshop.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  // ── Rate limiting — 1 reseña por IP cada 24 horas ──────────────
  if (checkRateLimit(getIP(req), 1, 24 * 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'Ya enviaste una reseña hoy. Podés intentar mañana.' });
  }

  try {
    const { name, text, stars, honeypot } = req.body;

    // ── Honeypot server-side ────────────────────────────────────────
    if (honeypot) return res.status(200).json({ ok: true });

    // ── Validaciones ────────────────────────────────────────────────
    if (!name || !text || !stars) {
      return res.status(400).json({ error: 'Completá todos los campos' });
    }
    if (text.length < 10 || text.length > 300) {
      return res.status(400).json({ error: 'La reseña debe tener entre 10 y 300 caracteres' });
    }
    if (stars < 1 || stars > 5) {
      return res.status(400).json({ error: 'Calificación inválida' });
    }

    const review = {
      name:      String(name).substring(0, 60),
      text:      String(text).substring(0, 300),
      stars:     Number(stars),
      status:    'pending',
      createdAt: new Date().toISOString(),
    };

    const key = 'review_' + Date.now();
    await fbSet(`reviews/${key}`, review);

    return res.status(200).json({ ok: true });

  } catch(err) {
    console.error('submit-review error:', err.message);
    return res.status(500).json({ error: 'Error al guardar la reseña' });
  }
};

function authParam() {
  return FIREBASE_SECRET ? `?auth=${FIREBASE_SECRET}` : '';
}

async function fbSet(path, data) {
  return new Promise((resolve, reject) => {
    const url    = `${FIREBASE_URL}/${path}.json${authParam()}`;
    const parsed = new URL(url);
    const body   = JSON.stringify(data);
    const req    = https.request({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'PUT',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let raw = ''; r.on('data', c => raw += c); r.on('end', () => resolve(raw)); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
