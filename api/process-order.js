// api/process-order.js
// Procesa el pedido aprobado: actualiza estado y descuenta stock
// Corre en el servidor — tiene acceso completo a Firebase sin restricciones de auth

const https = require('https');

const FIREBASE_DB_URL = process.env.FIREBASE_URL || 'https://ufobikeshop-default-rtdb.firebaseio.com';
const FIREBASE_SECRET = process.env.FIREBASE_SECRET; // Database Secret de Firebase

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { orderId, paymentId, status } = req.body;

    if (!orderId) return res.status(400).json({ error: 'orderId requerido' });
    if (status !== 'approved') {
      return res.status(200).json({ ok: true, msg: 'Pago no aprobado — sin cambios' });
    }

    console.log('process-order: procesando pedido', orderId);

    // ── Leer el pedido de Firebase ──
    const order = await fbGet(`orders/${orderId}`);
    if (!order) {
      console.error('Pedido no encontrado:', orderId);
      return res.status(404).json({ error: 'Pedido no encontrado' });
    }

    // ── Evitar procesar dos veces ──
    if (order.stockDescontado && order.paymentStatus === 'approved') {
      console.log('Pedido ya procesado:', orderId);
      return res.status(200).json({ ok: true, msg: 'Ya procesado' });
    }

    // ── Actualizar estado del pedido ──
    await fbPatch(`orders/${orderId}`, {
      paymentStatus:   'approved',
      paymentId:       paymentId || '',
      approvedAt:      new Date().toISOString(),
      stockDescontado: true,
    });

    // ── Descontar stock de cada producto ──
    const items = order.items || [];
    for (const item of items) {
      const prod = await fbGet(`products/${item.id}`);
      if (prod && prod.stock !== null && prod.stock !== undefined) {
        const nuevoStock = Math.max(0, Number(prod.stock) - Number(item.qty));
        await fbPatch(`products/${item.id}`, { stock: nuevoStock });
        console.log(`Stock: ${prod.name} → ${nuevoStock}`);
      }
    }

    console.log('process-order: pedido procesado OK');
    return res.status(200).json({ ok: true, orderId });

  } catch (err) {
    console.error('process-order error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

// ── Firebase helpers con secret (sin necesidad de auth de usuario) ──
function authParam() {
  return FIREBASE_SECRET ? `?auth=${FIREBASE_SECRET}` : '';
}

async function fbGet(path) {
  return new Promise((resolve, reject) => {
    const url = `${FIREBASE_DB_URL}/${path}.json${authParam()}`;
    const parsed = new URL(url);
    https.get({ hostname: parsed.hostname, path: parsed.pathname + parsed.search }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

async function fbPatch(path, data) {
  return new Promise((resolve, reject) => {
    const url    = `${FIREBASE_DB_URL}/${path}.json${authParam()}`;
    const parsed = new URL(url);
    const body   = JSON.stringify(data);
    const reqOpts = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   'PATCH',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(reqOpts, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
