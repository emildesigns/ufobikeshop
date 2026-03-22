// api/send-notification.js
// Vercel Serverless Function — envía email al dueño cuando se aprueba una compra

const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { orderId, items, total, approvedAt } = req.body;

    const SERVICE_ID  = process.env.EMAILJS_SERVICE_ID;
    const TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
    const PUBLIC_KEY  = process.env.EMAILJS_PUBLIC_KEY;
    const PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;
    const OWNER_EMAIL = process.env.OWNER_EMAIL;

    if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) {
      console.log('EmailJS no configurado — omitiendo notificación');
      return res.status(200).json({ ok: true, msg: 'EmailJS no configurado' });
    }

    const itemsList = (items || [])
      .map(i => `• ${i.name} x${i.qty} — $${Number(i.price * i.qty).toLocaleString('es-AR')}`)
      .join('\n');

    const fecha = new Date(approvedAt || Date.now())
      .toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

    const payload = {
      service_id:  SERVICE_ID,
      template_id: TEMPLATE_ID,
      user_id:     PUBLIC_KEY,
      accessToken: PRIVATE_KEY || '',
      template_params: {
        to_email:   OWNER_EMAIL || '',
        order_id:   orderId,
        order_date: fecha,
        items_list: itemsList,
        total:      `$${Number(total).toLocaleString('es-AR')}`,
        store_name: 'UFO Bike Shop',
      },
    };

    const result = await postJSON('api.emailjs.com', '/api/v1.0/email/send', payload);
    console.log('Email enviado:', result);

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Error send-notification:', err);
    return res.status(500).json({ error: err.message });
  }
};

function postJSON(host, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request(
      { hostname: host, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(raw); } });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
