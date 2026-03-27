// api/cotizar-envio.js
// Vercel Serverless Function — cotiza envío con Zipnova API v2

const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { cpDestino, peso, paquetes } = req.body;

    const ACCOUNT_ID = process.env.ZIPNOVA_ACCOUNT_ID;
    const API_KEY    = process.env.ZIPNOVA_API_KEY;
    const API_SECRET = process.env.ZIPNOVA_API_SECRET;
    const ORIGIN_ID  = process.env.ZIPNOVA_ORIGIN_ID;

    if (!ACCOUNT_ID || !API_KEY || !API_SECRET || !ORIGIN_ID) {
      console.error('Faltan variables de Zipnova');
      return res.status(200).json({ error: 'Zipnova no configurado', opciones: [] });
    }

    // Autenticacion basica HTTP: Base64(API_KEY:API_SECRET)
    const basicAuth = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');

    // Armar items — peso en gramos, dimensiones en cm
    const pesoPorPaquete = Math.round((peso / paquetes.length) * 1000);
    const items = paquetes.map((p, i) => {
      const parts = p.split('x').map(Number);
      return {
        sku:               `item-${i + 1}`,
        weight:            pesoPorPaquete,
        length:            parts[0] || 20,
        width:             parts[1] || 15,
        height:            parts[2] || 10,
        description:       'Producto UFO Bike Shop',
        classification_id: 1,
      };
    });

    const body = JSON.stringify({
      account_id:     String(ACCOUNT_ID),
      origin_id:      String(ORIGIN_ID),
      declared_value: 5000,
      items,
      destination: { zipcode: cpDestino },
    });

    console.log('Zipnova body:', body);

    const zipnovaRes = await apiPost(
      'api.zipnova.com.ar',
      '/v2/shipments/quote',
      body,
      {
        'Authorization':  `Basic ${basicAuth}`,
        'Content-Type':   'application/json',
        'Accept':         'application/json',
        'Content-Length': Buffer.byteLength(body),
      }
    );

    console.log('Zipnova resp:', JSON.stringify(zipnovaRes).substring(0, 500));

    if (!zipnovaRes || zipnovaRes.message || zipnovaRes.error) {
      return res.status(200).json({ error: 'Sin resultados', debug: zipnovaRes, opciones: [] });
    }

    const rates = Array.isArray(zipnovaRes) ? zipnovaRes : [];

    const andreani = rates.filter(r =>
      (r.carrier && r.carrier.name && r.carrier.name.toLowerCase().includes('andreani'))
    );

    const fuente = andreani.length > 0 ? andreani : rates;

    const opciones = fuente
      .map(r => ({
        id:          `envio-${r.carrier ? r.carrier.id : r.id || Math.random()}`,
        nombre:      `${r.carrier ? r.carrier.name : 'Envío'} — ${r.service_type || 'Estándar'}`,
        descripcion: r.estimated_delivery ? `Entrega en ${r.estimated_delivery} días hábiles` : 'Entrega a domicilio',
        precio:      Math.round(Number(r.total || r.price || 0)),
      }))
      .filter(o => o.precio > 0)
      .sort((a, b) => a.precio - b.precio)
      .slice(0, 3);

    return res.status(200).json({ opciones });

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(200).json({ error: err.message, opciones: [] });
  }
};

function apiPost(host, path, body, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: host, path, method: 'POST', headers }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => {
        console.log('Raw:', raw.substring(0, 300));
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ parseError: true, raw: raw.substring(0, 200) }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
