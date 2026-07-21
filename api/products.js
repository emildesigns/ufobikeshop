// api/products.js — Expone el catálogo de productos (Firebase) como JSON para consumo externo
const https = require('https');
const { checkRateLimit, getIP } = require('./_rateLimit');

const FIREBASE_URL     = process.env.FIREBASE_URL || 'https://ufobikeshop-default-rtdb.firebaseio.com';
const FIREBASE_SECRET  = process.env.FIREBASE_SECRET;
const PRODUCTS_API_KEY = process.env.PRODUCTS_API_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  if (!PRODUCTS_API_KEY) {
    return res.status(500).json({ error: 'API no configurada' });
  }
  if (req.headers['x-api-key'] !== PRODUCTS_API_KEY) {
    return res.status(401).json({ error: 'API key inválida o faltante' });
  }

  if (checkRateLimit(getIP(req), 60, 60000)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes. Intentá en un minuto.' });
  }

  try {
    const raw = await fbGet('products');
    let products = raw && typeof raw === 'object'
      ? Object.values(raw).filter(p => p && p.id && p.name)
      : [];

    const { cat, id } = new URL(req.url, 'http://x').searchParams.size
      ? Object.fromEntries(new URL(req.url, 'http://x').searchParams)
      : {};
    if (id)  products = products.filter(p => String(p.id) === String(id));
    if (cat) products = products.filter(p => p.cat === cat);

    const clean = products.map(p => ({
      id:       p.id,
      name:     p.name,
      desc:     p.desc || '',
      detail:   p.detail || '',
      category: p.cat || '',
      price:    Number(p.price) || 0,
      oldPrice: p.oldPrice ? Number(p.oldPrice) : null,
      stock:    p.stock ?? null,
      sizes:    p.sizes || null,
      badge:    p.badge || null,
      weight:   p.weight || null,
      dims:     p.dims || null,
      photos:   [p.photo, p.photo2, p.photo3, ...(Array.isArray(p.photos) ? p.photos : [])].filter(Boolean),
    }));

    return res.status(200).json({
      count:     clean.length,
      updatedAt: new Date().toISOString(),
      products:  clean,
    });

  } catch (err) {
    console.error('products API error:', err.message);
    return res.status(500).json({ error: 'Error al obtener productos' });
  }
};

function fbGet(path) {
  return new Promise((resolve, reject) => {
    const url = `${FIREBASE_URL}/${path}.json${FIREBASE_SECRET ? `?auth=${FIREBASE_SECRET}` : ''}`;
    const parsed = new URL(url);
    https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search }, r => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}
