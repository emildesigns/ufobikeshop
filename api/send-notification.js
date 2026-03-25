// api/send-notification.js
const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { orderId, items, total, subtotal, shipping, shippingCost, buyer, approvedAt } = req.body;

    const SERVICE_ID  = process.env.EMAILJS_SERVICE_ID;
    const TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
    const PUBLIC_KEY  = process.env.EMAILJS_PUBLIC_KEY;
    const PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;

    console.log('send-notification llamado para pedido:', orderId);
    console.log('Variables configuradas:', {
      SERVICE_ID:  SERVICE_ID  ? 'OK' : 'FALTA',
      TEMPLATE_ID: TEMPLATE_ID ? 'OK' : 'FALTA',
      PUBLIC_KEY:  PUBLIC_KEY  ? 'OK' : 'FALTA',
      PRIVATE_KEY: PRIVATE_KEY ? 'OK' : 'FALTA',
    });

    if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) {
      console.error('Faltan variables de EmailJS');
      return res.status(200).json({ ok: false, msg: 'EmailJS no configurado' });
    }

    const itemsList = (items || [])
      .map(i => `• ${i.name} x${i.qty} — $${Number(i.price * i.qty).toLocaleString('es-AR')}`)
      .join('\n');

    const fecha = new Date(approvedAt || Date.now())
      .toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

    // Datos del comprador
    let buyerStr = 'No especificado';
    if (buyer?.name) {
      buyerStr = buyer.name;
      if (buyer.street) buyerStr += `\n   Dirección: ${buyer.street}, ${buyer.city}, ${buyer.province} (CP: ${buyer.cp})`;
    }

    // Envío
    let shippingStr = 'Retiro en local';
    if (shipping && shipping.id !== 'retiro') {
      const precio = shippingCost === 0 ? 'GRATIS' : `$${Number(shippingCost).toLocaleString('es-AR')}`;
      shippingStr = `${shipping.nombre} — ${precio}`;
    }

    const payload = {
      service_id:  SERVICE_ID,
      template_id: TEMPLATE_ID,
      user_id:     PUBLIC_KEY,
      accessToken: PRIVATE_KEY || '',
      template_params: {
        order_id:    orderId,
        order_date:  fecha,
        items_list:  itemsList,
        subtotal:    `$${Number(subtotal || total).toLocaleString('es-AR')}`,
        shipping_info: shippingStr,
        total:       `$${Number(total).toLocaleString('es-AR')}`,
        buyer_info:  buyerStr,
        store_name:  'UFO Bike Shop',
      },
    };

    console.log('Llamando a EmailJS...');
    const result = await postJSON('api.emailjs.com', '/api/v1.0/email/send', payload);
    console.log('Respuesta de EmailJS:', JSON.stringify(result));

    return res.status(200).json({ ok: true, emailjs: result });

  } catch (err) {
    console.error('Error en send-notification:', err.message);
    return res.status(500).json({ error: err.message });
  }
};

function postJSON(host, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req  = https.request(
      {
        hostname: host, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      },
      res => {
        let raw = '';
        res.on('data', c => raw += c);
        res.on('end', () => {
          console.log('EmailJS raw response:', raw);
          try { resolve(JSON.parse(raw)); } catch { resolve({ raw }); }
        });
      }
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
