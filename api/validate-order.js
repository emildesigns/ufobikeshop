// api/validate-order.js — Valida el monto de un pedido de transferencia contra Firebase
const https = require('https');
const { checkRateLimit, getIP } = require('./_rateLimit');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  // Rate limiting — máximo 20 validaciones por IP por minuto
  if (checkRateLimit(getIP(req), 20, 60000)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes. Intentá en un minuto.' });
  }

  try {
    const { items, shippingCost, totalFromClient } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Carrito vacío' });
    }
    if (items.length > 50) {
      return res.status(400).json({ error: 'Demasiados productos' });
    }

    const FIREBASE_URL    = process.env.FIREBASE_URL || 'https://ufobikeshop-default-rtdb.firebaseio.com';
    const FIREBASE_SECRET = process.env.FIREBASE_SECRET;

    if (!FIREBASE_SECRET) {
      // Sin secret no podemos validar — aprobar con advertencia
      console.warn('validate-order: FIREBASE_SECRET no configurado');
      return res.status(200).json({ valid: true, warning: 'no-secret' });
    }

    // Obtener productos reales de Firebase
    const productsData = await getJSON(
      `${FIREBASE_URL}/products.json?auth=${FIREBASE_SECRET}`
    );

    if (!productsData) {
      return res.status(200).json({ valid: true, warning: 'no-products-data' });
    }

    // Convertir a array si es objeto
    const products = Array.isArray(productsData)
      ? productsData.filter(Boolean)
      : Object.values(productsData);

    // Recalcular subtotal con precios reales de Firebase
    let serverSubtotal = 0;
    for (const item of items) {
      const productId = Number(item.id);
      const qty       = Math.floor(Number(item.qty));

      if (isNaN(productId) || qty <= 0 || qty > 999) {
        return res.status(400).json({ error: `Item inválido: ${item.name}` });
      }

      const realProduct = products.find(p => Number(p.id) === productId);
      if (!realProduct) {
        return res.status(400).json({ error: `Producto no encontrado: ${item.name}` });
      }

      // Verificar stock
      if (realProduct.stock !== null && realProduct.stock !== undefined && qty > realProduct.stock) {
        return res.status(400).json({ error: `Stock insuficiente: ${realProduct.name}` });
      }

      serverSubtotal += Math.round(Number(realProduct.price)) * qty;
    }

    // Validar costo de envío
    const serverShipping = Math.max(0, Math.round(Number(shippingCost) || 0));
    const serverTotal    = serverSubtotal + serverShipping;
    const clientTotal    = Math.round(Number(totalFromClient) || 0);

    // Tolerar diferencia de hasta $1 por redondeos
    if (Math.abs(serverTotal - clientTotal) > 1) {
      console.warn(`validate-order: monto manipulado — cliente: $${clientTotal}, servidor: $${serverTotal}`);
      return res.status(400).json({
        error: 'El monto del pedido no coincide. Por favor recargá la página e intentá de nuevo.',
        serverTotal,
        clientTotal,
      });
    }

    return res.status(200).json({ valid: true, serverTotal });

  } catch (err) {
    console.error('validate-order error:', err.message);
    // En caso de error del servidor, dejar pasar para no bloquear ventas
    return res.status(200).json({ valid: true, warning: err.message });
  }
};

function getJSON(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.get({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      headers:  { 'Accept': 'application/json' }
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(null); }
      });
    }).on('error', reject);
  });
}
