// api/mp-webhook.js — con verificación de firma y protección contra pagos falsos

const https  = require('https');
const crypto = require('crypto');

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    // ── 1. Verificar firma de MercadoPago ──────────────────────────────────
    const SECRET      = process.env.MP_WEBHOOK_SECRET; // agregar en Vercel
    const xSignature  = req.headers['x-signature'];
    const xRequestId  = req.headers['x-request-id'];
    const dataId      = req.query['data.id'] || req.query.id;

    if (SECRET && xSignature && xRequestId) {
      // Construir el mensaje que MP firmó
      const parts = xSignature.split(',');
      const ts    = parts.find(p => p.startsWith('ts='))?.split('=')[1];
      const v1    = parts.find(p => p.startsWith('v1='))?.split('=')[1];

      if (ts && v1) {
        const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
        const expected = crypto
          .createHmac('sha256', SECRET)
          .update(manifest)
          .digest('hex');

        if (expected !== v1) {
          console.warn('Webhook firma inválida — posible intento de fraude');
          return res.status(401).send('Unauthorized');
        }
      }
    }

    // ── 2. Ignorar topics que no son pagos ────────────────────────────────
    const topic = req.query.topic || req.query.type;
    if (topic !== 'payment' && topic !== 'merchant_order') {
      return res.status(200).send('OK - ignored');
    }

    const paymentId = dataId;
    if (!paymentId) return res.status(200).send('OK - no id');

    // ── 3. Consultar el pago directamente a MP (nunca confiar en el body) ─
    const ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
    const payment = await getJSON(
      'api.mercadopago.com',
      `/v1/payments/${paymentId}`,
      { Authorization: `Bearer ${ACCESS_TOKEN}` }
    );

    if (!payment || !payment.id) {
      console.warn('Pago no encontrado en MP:', paymentId);
      return res.status(200).send('OK - payment not found');
    }

    // ── 4. Validar que el pago realmente está aprobado ────────────────────
    const orderId = payment.external_reference;
    const status  = payment.status;

    if (!orderId) return res.status(200).send('OK - no external_reference');

    // Solo procesar si el pago está aprobado (nunca marcar como pagado si no lo está)
    const allowedStatuses = ['approved', 'pending', 'in_process', 'rejected', 'cancelled'];
    if (!allowedStatuses.includes(status)) {
      console.warn('Estado de pago desconocido:', status);
      return res.status(200).send('OK - unknown status');
    }

    // ── 5. Validar monto mínimo (evitar pagos de $0 o negativos) ─────────
    const amount = Number(payment.transaction_amount);
    if (status === 'approved' && (isNaN(amount) || amount <= 0)) {
      console.warn('Pago aprobado con monto inválido:', amount);
      return res.status(200).send('OK - invalid amount');
    }

    // ── 6. Actualizar Firebase ────────────────────────────────────────────
    const FIREBASE_URL = process.env.FIREBASE_URL || 'https://ufobikeshop-default-rtdb.firebaseio.com';

    await patchJSON(
      `${FIREBASE_URL}/orders/${orderId}.json`,
      {
        paymentStatus: status,
        paymentId:     String(paymentId),
        updatedAt:     new Date().toISOString(),
        mpData: {
          statusDetail:      payment.status_detail,
          transactionAmount: amount,
          paymentMethodId:   payment.payment_method_id,
          payerEmail:        payment.payer?.email || '',
        },
      }
    );

    console.log(`✅ Pago ${paymentId} (${status} $${amount}) → Pedido ${orderId} actualizado`);
    return res.status(200).send('OK');

  } catch (err) {
    console.error('Webhook error:', err.message);
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
      {
        hostname: parsed.hostname,
        path:     parsed.pathname + parsed.search,
        method:   'PATCH',
        headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
      },
      res => { res.on('data', () => {}); res.on('end', resolve); }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
