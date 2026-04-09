// api/cotizar-envio.js — Integración Correo Argentino API MiCorreo v1
const https = require('https');

// Cache del token JWT para no pedir uno nuevo en cada request
let tokenCache = { token: null, expires: null };

async function getToken() {
  // Si el token es válido por más de 5 minutos, lo reutilizamos
  if (tokenCache.token && tokenCache.expires && new Date(tokenCache.expires) > new Date(Date.now() + 5 * 60 * 1000)) {
    return tokenCache.token;
  }

  const user = process.env.CORREO_USER;
  const pass = process.env.CORREO_PASS;

  if (!user || !pass) throw new Error('Faltan credenciales CORREO_USER / CORREO_PASS');

  const basicAuth = Buffer.from(`${user}:${pass}`).toString('base64');

  const data = await request({
    hostname: 'api.correoargentino.com.ar',
    path:     '/micorreo/v1/token',
    method:   'POST',
    headers:  { 'Authorization': `Basic ${basicAuth}` },
  });

  if (!data.token) throw new Error('No se obtuvo token de Correo Argentino');

  tokenCache = { token: data.token, expires: data.expires };
  return data.token;
}

async function cotizarEnvio(token, customerId, cpOrigen, cpDestino, pesoGramos, dims) {
  const body = JSON.stringify({
    customerId,
    postalCodeOrigin:      String(cpOrigen),
    postalCodeDestination: String(cpDestino),
    dimensions: {
      weight: Math.max(1, Math.round(pesoGramos)),
      height: Math.max(1, Math.round(dims.height || 10)),
      width:  Math.max(1, Math.round(dims.width  || 15)),
      length: Math.max(1, Math.round(dims.length || 20)),
    },
  });

  return await request({
    hostname: 'api.correoargentino.com.ar',
    path:     '/micorreo/v1/rates',
    method:   'POST',
    headers:  {
      'Authorization':  `Bearer ${token}`,
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
  }, body);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { cpDestino, pesoKg, dims } = req.body;

    if (!cpDestino || cpDestino.length < 4) {
      return res.status(400).json({ error: 'CP de destino inválido' });
    }

    const CUSTOMER_ID = process.env.CORREO_CUSTOMER_ID;
    const CP_ORIGEN   = process.env.CORREO_CP_ORIGEN || '4107';

    if (!process.env.CORREO_USER || !process.env.CORREO_PASS || !CUSTOMER_ID) {
      return res.status(200).json({ error: 'Credenciales no configuradas', opciones: [] });
    }

    const pesoGramos = Math.max(1, Math.round((pesoKg || 0.5) * 1000));

    // Obtener token JWT
    const token = await getToken();

    // Cotizar con Correo Argentino
    const result = await cotizarEnvio(token, CUSTOMER_ID, CP_ORIGEN, cpDestino, pesoGramos, dims || {});

    if (!result || !result.rates || result.rates.length === 0) {
      return res.status(200).json({ error: 'Sin cotización disponible para ese CP', opciones: [] });
    }

    // Formatear opciones
    const opciones = result.rates.map(r => ({
      id:          r.deliveredType === 'D' ? 'correo-domicilio' : 'correo-sucursal',
      nombre:      r.deliveredType === 'D' ? 'Correo Argentino — Domicilio' : 'Correo Argentino — Sucursal',
      descripcion: `Correo Argentino · ${r.productName || 'Clásico'} · Entrega a domicilio`,
      precio:      Math.round(r.price),
    }));

    return res.status(200).json({ opciones });

  } catch(err) {
    // Si falla la API de Correo, devolver error para que el frontend use el tarifario OCA
    return res.status(200).json({ error: err.message, opciones: [] });
  }
};

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ raw: raw.substring(0, 300) }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout Correo Argentino')); });
    if (body) req.write(body);
    req.end();
  });
}
