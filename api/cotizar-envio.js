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

    if (!ACCOUNT_ID || !API_KEY || !API_SECRET || !ORIGIN_ID) {
      return res.status(200).json({ error: 'Faltan variables de entorno de Zipnova', opciones: [] });
    }

    // Paso 1: resolver CP a ciudad/provincia
    let ciudad = 'Buenos Aires';
    let provincia = 'Buenos Aires';
    try {
      const geoData = await get(
        'apis.datos.gob.ar',
        `/georef/api/localidades?codigo_postal=${cpDestino}&campos=nombre,provincia.nombre&max=1`
      );
      if (geoData && geoData.localidades && geoData.localidades.length > 0) {
        ciudad    = geoData.localidades[0].nombre || ciudad;
        provincia = geoData.localidades[0].provincia.nombre || provincia;
      }
    } catch(e) { console.warn('Geo error:', e.message); }

    console.log(`CP ${cpDestino} → ${ciudad}, ${provincia}`);

    // Paso 2: cotizar con Zipnova
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
        description: 'Producto UFO Bike Shop',
        classification_id: 1,
      };
    });

    const payload = {
      account_id:     String(ACCOUNT_ID),
      origin_id:      String(ORIGIN_ID),
      declared_value: 10000,
      items,
      destination: { zipcode: String(cpDestino), city: ciudad, state: provincia },
    };

    const bodyStr = JSON.stringify(payload);
    const result  = await apiPost('api.zipnova.com.ar', '/v2/shipments/quote', bodyStr, {
      'Authorization':  `Basic ${basicAuth}`,
      'Content-Type':   'application/json',
      'Accept':         'application/json',
      'Content-Length': Buffer.byteLength(bodyStr),
    });

    // La respuesta tiene all_results con todos los transportistas
    const allResults = result.all_results || [];

    if (allResults.length === 0) {
      return res.status(200).json({ error: 'Sin opciones disponibles', opciones: [], ciudad, provincia });
    }

    // Formatear opciones — usar price_incl_tax (precio con IVA que paga el comprador)
    const opciones = allResults
      .filter(r => r.selectable && r.amounts && r.amounts.price_incl_tax > 0)
      .map(r => {
        const dias = r.delivery_time
          ? `${r.delivery_time.min}–${r.delivery_time.max} días hábiles`
          : 'Entrega a domicilio';
        const tipoEntrega = r.service_type ? r.service_type.name : 'Entrega';
        return {
          id:          `${r.carrier.id}-${r.service_type.id}`,
          nombre:      `${r.carrier.name} — ${tipoEntrega}`,
          descripcion: dias,
          precio:      Math.round(r.amounts.price_incl_tax),
        };
      })
      .sort((a, b) => a.precio - b.precio);

    return res.status(200).json({ opciones, ciudad, provincia });

  } catch (err) {
    console.error('Error:', err.message);
    return res.status(200).json({ error: err.message, opciones: [] });
  }
};

function get(host, path) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: host, path, headers: { 'Accept': 'application/json' } }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
    }).on('error', reject);
  });
}

function apiPost(host, path, body, headers) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: host, path, method: 'POST', headers }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ parseError: true, raw: raw.substring(0, 200) }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
