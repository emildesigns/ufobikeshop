// api/mp-webhook.js
// Vercel Serverless Function — recibe notificaciones de MercadoPago y actualiza Firebase

const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const params  = req.query || {};
    const topic   = params.topic || params.type;

    if (topic !== 'payment' && topic !== 'merchant_order') {
      return res.status(200).send('OK - ignored');
    }

    const paymentId = params.id || params['data.id'];
    if (!paymentId) return res.status(200).send('OK - no id');

    const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const payment = await getJSON(
      'api.mercadopago.com',
      `/v1/payments/${paymentId}`,
      { Authorization: `Bearer ${ACCESS_TOKEN}` }
    );

    const orderId = payment.external_reference;
    const status  = payment.status;
    if (!orderId) return res.status(200).send('OK - no external_reference');

    const FIREBASE_URL = process.env.FIREBASE_URL || 'https://ufobikeshop-default-rtdb.firebaseio.com';

    await patchJSON(
      `${FIREBASE_URL}/orders/${orderId}.json`,
      {
        paymentStatus: status,
        paymentId:     String(paymentId),
        updatedAt:     new Date().toISOString(),
        mpData: {
          statusDetail:      payment.status_detail,
          transactionAmount: payment.transaction_amount,
          paymentMethodId:   payment.payment_method_id,
          payerEmail:        payment.payer?.email || '',
        },
      }
    );

    console.log(`Pago ${paymentId} → ${status} → Pedido ${orderId} actualizado`);
    return res.status(200).send('OK');

  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).send('Error: ' + err.message);
  }
};

function getJSON(host, path, headers) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: host, path, headers }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve({}); } });
    }).on('error', reject);
  });
}

function patchJSON(url, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const data   = JSON.stringify(body);
    const req    = https.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => { res.on('data', () => {}); res.on('end', resolve); }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
