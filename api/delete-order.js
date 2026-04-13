// api/delete-order.js — Elimina un pedido de Firebase
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
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId requerido' });
    if (!FIREBASE_SECRET) return res.status(500).json({ error: 'Sin configuración de Firebase' });

    await fbDelete(`orders/${orderId}`);
    console.log(`Pedido ${orderId} eliminado`);
    return res.status(200).json({ ok: true, orderId });

  } catch(err) {
    console.error('delete-order error:', err.message);
    return res.status(500).json({ error: 'Error al eliminar el pedido' });
  }
};

function authParam() {
  return FIREBASE_SECRET ? `?auth=${FIREBASE_SECRET}` : '';
}

async function fbDelete(path) {
  return new Promise((resolve, reject) => {
    const url    = `${FIREBASE_URL}/${path}.json${authParam()}`;
    const parsed = new URL(url);
    const req    = https.request({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'DELETE',
    }, r => { let raw = ''; r.on('data', c => raw += c); r.on('end', () => resolve(raw)); });
    req.on('error', reject);
    req.end();
  });
}
