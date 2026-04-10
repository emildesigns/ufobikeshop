// api/cotizar-envio.js — Correo Argentino API MiCorreo v1
const https = require('https');
const { checkRateLimit, getIP } = require('./_rateLimit');

let tokenCache = { token: null, expires: null };

async function getToken() {
  if (tokenCache.token && tokenCache.expires && new Date(tokenCache.expires) > new Date(Date.now() + 5 * 60 * 1000)) {
    return tokenCache.token;
  }
  const user = process.env.CORREO_USER;
  const pass = process.env.CORREO_PASS;
  const basicAuth = Buffer.from(`${user}:${pass}`).toString('base64');
  const data = await request({
    hostname: 'api.correoargentino.com.ar',
    path:     '/micorreo/v1/token',
    method:   'POST',
    headers:  { 'Authorization': `Basic ${basicAuth}` },
  });
  if (!data.token) throw new Error(`Token error: ${JSON.stringify(data)}`);
  tokenCache = { token: data.token, expires: data.expires };
  return data.token;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  // Rate limiting — máximo 30 cotizaciones por IP por minuto
  if (checkRateLimit(getIP(req), 30, 60000)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes. Intentá en un minuto.', opciones: [] });
  }

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
    const token      = await getToken();

    // Según el manual los CPs van SIN prefijo de provincia — solo números
    const cpOrigenNum  = String(CP_ORIGEN).replace(/[^0-9]/g, '');
    const cpDestinoNum = String(cpDestino).replace(/[^0-9]/g, '');

    const body = JSON.stringify({
      customerId:            String(CUSTOMER_ID),
      postalCodeOrigin:      cpOrigenNum,
      postalCodeDestination: cpDestinoNum,
      deliveredType:         'D',
      dimensions: {
        weight: pesoGramos,
        height: Math.max(1, Math.round(dims?.height || 10)),
        width:  Math.max(1, Math.round(dims?.width  || 15)),
        length: Math.max(1, Math.round(dims?.length || 20)),
      },
    });

    const result = await request({
      hostname: 'api.correoargentino.com.ar',
      path:     '/micorreo/v1/rates',
      method:   'POST',
      headers:  {
        'Authorization':  `Bearer ${token}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);

    if (!result || !result.rates || result.rates.length === 0) {
      return res.status(200).json({
        error: `Sin cotización para CP ${cpDestinoNum}`,
        rawResult: result,
        opciones: []
      });
    }

    const opciones = result.rates.map(r => ({
      id:          'correo-domicilio',
      nombre:      'Correo Argentino — Domicilio',
      descripcion: `Correo Argentino · ${r.productName || 'Clásico'} · Entrega a domicilio`,
      precio:      Math.round(r.price),
    }));

    return res.status(200).json({ opciones });

  } catch(err) {
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
        catch { resolve({ parseError: true, raw: raw.substring(0, 500) }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout 10s')); });
    if (body) req.write(body);
    req.end();
  });
}
