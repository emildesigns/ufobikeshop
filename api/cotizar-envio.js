// api/cotizar-envio.js
// Vercel Serverless Function — cotiza envío con Zipnova (Andreani)

const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { cpDestino, peso, paquetes } = req.body;

    const ACCOUNT_ID  = process.env.ZIPNOVA_ACCOUNT_ID;
    const API_KEY     = process.env.ZIPNOVA_API_KEY;
    const API_SECRET  = process.env.ZIPNOVA_API_SECRET;
    const ORIGIN_ID   = process.env.ZIPNOVA_ORIGIN_ID;

    if (!ACCOUNT_ID || !API_KEY || !API_SECRET || !ORIGIN_ID) {
      console.error('Faltan variables de Zipnova');
      return res.status(200).json({ error: 'Zipnova no configurado', opciones: [] });
    }

    // Autenticación Bearer de Zipnova
    const token = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');

    // Armar paquetes en formato Zipnova: "LxAxH" → { long, alto, ancho, peso_gramos }
    const paquetesZipnova = paquetes.map(p => {
      const [l, a, h] = p.split('x').map(Number);
      return {
        largo: l || 20,
        ancho: a || 15,
        alto:  h || 10,
        peso:  Math.round((peso / paquetes.length) * 1000), // gramos por paquete
      };
    });

    // Endpoint de cotización de Zipnova
    const body = JSON.stringify({
      account_id:        ACCOUNT_ID,
      origin_id:         ORIGIN_ID,
      destination: {
        zip_code: cpDestino,
      },
      declared_value: 1000,
      packages: paquetesZipnova,
    });

    const zipnovaRes = await apiCall(
      'api.zipnova.com.ar',
      '/v1/shipments/quote',
      'POST',
      body,
      {
        'Authorization': `Basic ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      }
    );

    console.log('Zipnova response:', JSON.stringify(zipnovaRes));

    if (!zipnovaRes || zipnovaRes.error) {
      return res.status(200).json({ error: 'Sin resultados', opciones: [] });
    }

    // Filtrar solo Andreani y formatear respuesta
    const rates = Array.isArray(zipnovaRes) ? zipnovaRes : (zipnovaRes.rates || zipnovaRes.quotes || []);

    const opciones = rates
      .filter(r => {
        const carrier = (r.carrier?.name || r.carrier_name || r.service_name || '').toLowerCase();
        return carrier.includes('andreani');
      })
      .map(r => ({
        id:          `andreani-${r.service_type || r.id || Math.random()}`,
        nombre:      `Andreani — ${r.service_name || r.service_type || 'Envío estándar'}`,
        descripcion: r.estimated_delivery ? `Entrega estimada: ${r.estimated_delivery}` : 'Entrega a domicilio',
        precio:      Math.round(Number(r.total || r.price || r.total_price || 0)),
      }))
      .filter(o => o.precio > 0)
      .sort((a, b) => a.precio - b.precio);

    // Si no hay Andreani disponible, devolver todos los carriers
    if (opciones.length === 0) {
      const todas = rates.map(r => ({
        id:          `carrier-${r.id || Math.random()}`,
        nombre:      r.carrier?.name || r.carrier_name || r.service_name || 'Envío',
        descripcion: r.estimated_delivery ? `Entrega: ${r.estimated_delivery}` : 'Entrega a domicilio',
        precio:      Math.round(Number(r.total || r.price || r.total_price || 0)),
      })).filter(o => o.precio > 0).sort((a, b) => a.precio - b.precio).slice(0, 3);

      return res.status(200).json({ opciones: todas });
    }

    return res.status(200).json({ opciones });

  } catch (err) {
    console.error('Error cotizar-envio:', err.message);
    return res.status(200).json({ error: err.message, opciones: [] });
  }
};

function apiCall(host, path, method, body, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: host, path, method, headers },
      r => {
        let raw = '';
        r.on('data', c => raw += c);
        r.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch { resolve({ raw, error: 'parse error' }); }
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
