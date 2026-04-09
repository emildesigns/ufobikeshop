// api/cotizar-envio.js — DEBUG VERSION
const https = require('https');

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

  try {
    const { cpDestino, pesoKg, dims } = req.body;
    const CUSTOMER_ID = process.env.CORREO_CUSTOMER_ID;
    const CP_ORIGEN   = process.env.CORREO_CP_ORIGEN || '4107';

    const pesoGramos = Math.max(1, Math.round((pesoKg || 0.5) * 1000));
    const token = await getToken();

    const body = JSON.stringify({
      customerId:            String(CUSTOMER_ID),
      postalCodeOrigin:      String(CP_ORIGEN),
      postalCodeDestination: String(cpDestino),
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

    // Devolver respuesta COMPLETA para diagnóstico
    return res.status(200).json({ rawResult: result, opciones: [] });

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
