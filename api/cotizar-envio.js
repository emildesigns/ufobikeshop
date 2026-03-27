// api/cotizar-envio.js — Zipnova API v2
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

    // Log para diagnóstico
    console.log('Variables:', { ACCOUNT_ID: ACCOUNT_ID ? 'OK' : 'FALTA', API_KEY: API_KEY ? 'OK' : 'FALTA', API_SECRET: API_SECRET ? 'OK' : 'FALTA', ORIGIN_ID: ORIGIN_ID ? 'OK' : 'FALTA' });
    console.log('Request:', { cpDestino, peso, paquetes });

    if (!ACCOUNT_ID || !API_KEY || !API_SECRET || !ORIGIN_ID) {
      return res.status(200).json({ error: 'Faltan variables de entorno de Zipnova', opciones: [] });
    }

    const basicAuth = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');
    const pesoPorItem = Math.max(100, Math.round((peso / paquetes.length) * 1000));

    const items = paquetes.map((p, i) => {
      const parts = p.split('x').map(n => Math.max(1, Number(n) || 10));
      return {
        sku: `sku-${i + 1}`,
        weight: pesoPorItem,
        length: parts[0],
        width:  parts[1] || parts[0],
        height: parts[2] || parts[0],
        description: 'Producto',
        classification_id: 1,
      };
    });

    const payload = {
      account_id:     String(ACCOUNT_ID),
      origin_id:      String(ORIGIN_ID),
      declared_value: 10000,
      items,
      destination:    { zipcode: String(cpDestino) },
    };

    const bodyStr = JSON.stringify(payload);
    console.log('Payload:', bodyStr);

    const result = await post('api.zipnova.com.ar', '/v2/shipments/quote', bodyStr, {
      'Authorization':  `Basic ${basicAuth}`,
      'Content-Type':   'application/json',
      'Accept':         'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
    });

    console.log('Zipnova resultado:', JSON.stringify(result).substring(0, 800));

    // Devolver respuesta raw para diagnóstico además de opciones
    if (!Array.isArray(result)) {
      return res.status(200).json({ error: 'Respuesta inesperada de Zipnova', raw: result, opciones: [] });
    }

    const opciones = result
      .map(r => ({
        id:          `envio-${r.logistic_type || r.service_type || Math.random()}`,
        nombre:      `${r.carrier ? r.carrier.name : 'Envío'} — ${r.service_type || 'Estándar'}`,
        descripcion: r.estimated_delivery ? `${r.estimated_delivery} días hábiles` : 'Entrega a domicilio',
        precio:      Math.round(Number(r.total || r.price || 0)),
      }))
      .filter(o => o.precio > 0)
      .sort((a, b) => a.precio - b.precio)
      .slice(0, 5);

    return res.status(200).json({ opciones });

  } catch (err) {
    console.error('Error:', err.message, err.stack);
    return res.status(200).json({ error: err.message, opciones: [] });
  }
};

function post(host, path, body, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: host, path, method: 'POST', headers }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => {
        console.log('HTTP status:', r.statusCode, '| raw:', raw.substring(0, 400));
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ httpStatus: r.statusCode, parseError: true, raw: raw.substring(0, 300) }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
