// api/create-preference.js — con validación, rate limiting y compatibilidad prueba/producción

const https = require('https');

// Rate limiting
const rateLimitMap = new Map();
const RATE_LIMIT   = 10;
const RATE_WINDOW  = 60000;

function checkRateLimit(ip) {
  const now  = Date.now();
  const data = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };
  if (now > data.resetAt) { data.count = 0; data.resetAt = now + RATE_WINDOW; }
  data.count++;
  rateLimitMap.set(ip, data);
  if (rateLimitMap.size > 1000) {
    for (const [k, v] of rateLimitMap) {
      if (now > v.resetAt) rateLimitMap.delete(k);
    }
  }
  return data.count > RATE_LIMIT;
}

function sanitizeString(str, maxLen = 200) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>\"']/g, '').substring(0, maxLen).trim();
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  // Rate limiting
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
          || req.headers['x-real-ip']
          || 'unknown';
  if (checkRateLimit(ip)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes. Intentá en un minuto.' });
  }

  try {
    const { items, buyer, orderId, shippingCost } = req.body;

    // Validación de items
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'El carrito está vacío.' });
    }
    if (items.length > 50) {
      return res.status(400).json({ error: 'Demasiados productos en el carrito.' });
    }
    for (const item of items) {
      const price = Number(item.price);
      const qty   = Number(item.qty);
      if (isNaN(price) || price <= 0 || price > 100_000_000) {
        return res.status(400).json({ error: 'Precio de producto inválido.' });
      }
      if (isNaN(qty) || qty <= 0 || qty > 999 || !Number.isInteger(qty)) {
        return res.status(400).json({ error: 'Cantidad de producto inválida.' });
      }
      if (!item.name || typeof item.name !== 'string') {
        return res.status(400).json({ error: 'Nombre de producto inválido.' });
      }
    }

    const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const SUCCESS_URL  = process.env.MP_SUCCESS_URL  || 'https://ufo-bikeshop.vercel.app/gracias.html';
    const FAILURE_URL  = process.env.MP_FAILURE_URL  || 'https://ufo-bikeshop.vercel.app';
    const WEBHOOK_URL  = process.env.MP_WEBHOOK_URL  || 'https://ufo-bikeshop.vercel.app/api/mp-webhook';

    if (!ACCESS_TOKEN) {
      return res.status(500).json({ error: 'Configuración de pago incompleta.' });
    }

    // Construir items sanitizados
    const mpItems = items.map(item => ({
      id:          String(item.id).substring(0, 50),
      title:       sanitizeString(item.name, 256),
      description: sanitizeString(item.desc || item.name, 256),
      quantity:    Math.floor(Number(item.qty)),
      unit_price:  Math.round(Number(item.price) * 100) / 100,
      currency_id: 'ARS',
    }));

    // Agregar envío si corresponde
    const sc = Number(shippingCost);
    if (!isNaN(sc) && sc > 0) {
      mpItems.push({
        id:          'envio',
        title:       'Envío a domicilio',
        description: 'Costo de envío',
        quantity:    1,
        unit_price:  sc,
        currency_id: 'ARS',
      });
    }

    const safeOrderId = sanitizeString(String(orderId || `UFO-${Date.now()}`), 50);

    // Construir preferencia — sin payer vacío ni expiration que cause problemas en prueba
    const preference = {
      items:                mpItems,
      back_urls: {
        success: SUCCESS_URL,
        failure: FAILURE_URL,
        pending: SUCCESS_URL,
      },
      auto_return:          'approved',
      statement_descriptor: 'UFO BIKE SHOP',
      external_reference:   safeOrderId,
      notification_url:     WEBHOOK_URL,
    };

    // Agregar payer solo si tiene email válido
    if (buyer && buyer.email && buyer.email.includes('@')) {
      preference.payer = {
        name:  sanitizeString(buyer.name || '', 100),
        email: sanitizeString(buyer.email, 200),
      };
    }

    console.log('Creando preferencia MP:', safeOrderId, 'items:', mpItems.length);

    const mpResponse = await postJSON(
      'api.mercadopago.com',
      '/checkout/preferences',
      preference,
      { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
    );

    console.log('Respuesta MP:', JSON.stringify(mpResponse).substring(0, 200));

    if (mpResponse.error || mpResponse.status === 400) {
      throw new Error(mpResponse.message || mpResponse.cause?.[0]?.description || JSON.stringify(mpResponse));
    }
    if (!mpResponse.id) {
      throw new Error('MP no devolvió ID de preferencia: ' + JSON.stringify(mpResponse).substring(0, 200));
    }

    const isSandbox = ACCESS_TOKEN.startsWith('TEST-');
    return res.status(200).json({
      preferenceId: mpResponse.id,
      checkoutUrl:  isSandbox ? mpResponse.sandbox_init_point : mpResponse.init_point,
      sandboxMode:  isSandbox,
      externalRef:  safeOrderId,
    });

  } catch (err) {
    console.error('Error create-preference:', err.message);
    return res.status(500).json({ error: 'Error al procesar el pago: ' + err.message });
  }
};

function postJSON(host, path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request(
      {
        hostname: host,
        path,
        method:  'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(data) }
      },
      res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch { resolve({ error: true, message: raw }); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
