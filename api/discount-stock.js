// api/discount-stock.js — Descuenta stock desde el servidor (para transferencias)
const https = require('https');

const FIREBASE_URL    = process.env.FIREBASE_URL || 'https://ufobikeshop-default-rtdb.firebaseio.com';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://ufo-bikeshop.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { orderId, items } = req.body;
    if (!orderId || !items) return res.status(400).json({ error: 'orderId e items requeridos' });
    if (!FIREBASE_SECRET) return res.status(500).json({ error: 'Sin configuración' });

    // Parsear items si es string
    let itemsList = items;
    if (typeof itemsList === 'string') {
      try { itemsList = JSON.parse(itemsList); } catch(e) { itemsList = []; }
    }
    if (!Array.isArray(itemsList)) itemsList = Object.values(itemsList);

    // Descontar stock de cada producto
    for (const item of itemsList) {
      if (!item?.id) continue;
      const prod = await fbGet(`products/${item.id}`);
      if (prod && prod.stock !== null && prod.stock !== undefined) {
        const newStock = Math.max(0, Number(prod.stock || 0) - Number(item.qty || 1));
        await fbPatch(`products/${item.id}`, { stock: newStock });
        console.log(`Stock descontado: ${prod.name || item.id} → ${newStock}`);
      }
    }

    // Marcar en el pedido que el stock fue descontado
    await fbPatch(`orders/${orderId}`, { stockDescontado: true });

    return res.status(200).json({ ok: true });

  } catch(err) {
    console.error('discount-stock error:', err.message);
    return res.status(500).json({ error: 'Error al descontar stock' });
  }
};

function authParam() {
  return FIREBASE_SECRET ? `?auth=${FIREBASE_SECRET}` : '';
}
async function fbGet(path) {
  return new Promise((resolve, reject) => {
    const url = `${FIREBASE_URL}/${path}.json${authParam()}`;
    const parsed = new URL(url);
    https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}
async function fbPatch(path, data) {
  return new Promise((resolve, reject) => {
    const url = `${FIREBASE_URL}/${path}.json${authParam()}`;
    const parsed = new URL(url);
    const body = JSON.stringify(data);
    const req = https.request({
      hostname: parsed.hostname, path: parsed.pathname + parsed.search,
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let raw = ''; r.on('data', c => raw += c); r.on('end', () => resolve(raw)); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
