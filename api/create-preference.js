// api/create-preference.js
// Vercel Serverless Function — crea la preferencia de pago en MercadoPago

const https = require('https');

module.exports = async (req, res) => {
  // CORS preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { items, buyer, orderId } = req.body;

    const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const SUCCESS_URL  = process.env.MP_SUCCESS_URL  || 'https://tu-sitio.vercel.app/gracias.html';
    const FAILURE_URL  = process.env.MP_FAILURE_URL  || 'https://tu-sitio.vercel.app';
    const WEBHOOK_URL  = process.env.MP_WEBHOOK_URL  || 'https://tu-sitio.vercel.app/api/mp-webhook';

    if (!ACCESS_TOKEN) {
      return res.status(500).json({ error: 'MP_ACCESS_TOKEN no configurado en las variables de entorno de Vercel' });
    }

    const preference = {
      items: items.map(item => ({
        id:          String(item.id),
        title:       item.name,
        description: item.desc || item.name,
        quantity:    Number(item.qty),
        unit_price:  Number(item.price),
        currency_id: 'ARS',
      })),
      payer: buyer ? {
        name:  buyer.name  || '',
        email: buyer.email || '',
      } : undefined,
      back_urls: {
        success: SUCCESS_URL,
        failure: FAILURE_URL,
        pending: SUCCESS_URL,
      },
      auto_return:          'approved',
      statement_descriptor: 'UFO BIKE SHOP',
      external_reference:   orderId || `UFO-${Date.now()}`,
      notification_url:     WEBHOOK_URL,
    };

    const mpResponse = await postJSON(
      'api.mercadopago.com',
      '/checkout/preferences',
      preference,
      { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
    );

    if (mpResponse.error) throw new Error(mpResponse.message || JSON.stringify(mpResponse));

    const isSandbox = ACCESS_TOKEN.startsWith('TEST-');
    return res.status(200).json({
      preferenceId: mpResponse.id,
      checkoutUrl:  isSandbox ? mpResponse.sandbox_init_point : mpResponse.init_point,
      sandboxMode:  isSandbox,
      externalRef:  preference.external_reference,
    });

  } catch (err) {
    console.error('Error create-preference:', err);
    return res.status(500).json({ error: err.message });
  }
};

function postJSON(host, path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request(
      { hostname: host, path, method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(data) } },
      (res) => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({ error: true, message: raw }); } });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
