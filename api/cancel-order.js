// api/cancel-order.js — Cancela un pedido y devuelve el stock
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

    // Leer el pedido
    const order = await fbGet(`orders/${orderId}`);
    if (!order) return res.status(404).json({ error: 'Pedido no encontrado' });

    // Verificar que esté en estado pending_transfer
    if (order.paymentStatus !== 'pending_transfer') {
      return res.status(400).json({ error: `No se puede cancelar un pedido con estado: ${order.paymentStatus}` });
    }

    // Marcar como cancelado PRIMERO para evitar doble ejecución
    await fbPatch(`orders/${orderId}`, {
      paymentStatus: 'cancelled',
      cancelledAt:   new Date().toISOString(),
    });

    // Parsear items
    let items = order.items || [];
    if (typeof items === 'string') {
      try { items = JSON.parse(items); } catch(e) { items = []; }
    }
    if (!Array.isArray(items)) items = Object.values(items);

    // Devolver stock a cada producto — leer stock actual de Firebase
    for (const item of items) {
      if (!item?.id) continue;
      const prod = await fbGet(`products/${item.id}`);
      if (prod && prod.stock !== null && prod.stock !== undefined) {
        const stockActual = Number(prod.stock || 0);
        const qty         = Number(item.qty || 1);
        const newStock    = stockActual + qty;
        await fbPatch(`products/${item.id}`, { stock: newStock });
        console.log(`Stock devuelto: ${prod.name || item.id} ${stockActual} + ${qty} → ${newStock}`);
      }
    }

    console.log(`Pedido ${orderId} cancelado — stock devuelto`);
    return res.status(200).json({ ok: true, orderId });

  } catch(err) {
    console.error('cancel-order error:', err.message);
    return res.status(500).json({ error: 'Error al cancelar el pedido' });
  }
};

function authParam() {
  return FIREBASE_SECRET ? `?auth=${FIREBASE_SECRET}` : '';
}

async function fbGet(path) {
  return new Promise((resolve, reject) => {
    const url    = `${FIREBASE_URL}/${path}.json${authParam()}`;
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
    const url    = `${FIREBASE_URL}/${path}.json${authParam()}`;
    const parsed = new URL(url);
    const body   = JSON.stringify(data);
    const req    = https.request({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'PATCH',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, r => { let raw = ''; r.on('data', c => raw += c); r.on('end', () => resolve(raw)); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
