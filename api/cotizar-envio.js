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
  if (!data.token) throw new Error('No se pudo autenticar con Correo Argentino');
  tokenCache = { token: data.token, expires: data.expires };
  return data.token;
}

module.exports = async (req, res) => {
  // ── CORS restringido al dominio propio ──────────────────────────────
  const origin = req.headers.origin || '';
  const allowed = ['https://ufo-bikeshop.vercel.app'];
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method Not Allowed' });

  // ── Rate limiting — máximo 30 cotizaciones por IP por minuto ────────
  if (checkRateLimit(getIP(req), 30, 60000)) {
    return res.status(429).json({ error: 'Demasiadas solicitudes. Intentá en un minuto.', opciones: [] });
  }

  try {
    const { cpDestino, pesoKg, dims } = req.body;

    // ── Validación de CP ────────────────────────────────────────────
    const cpLimpio = String(cpDestino || '').replace(/\D/g, '');
    if (!cpLimpio || cpLimpio.length < 4 || cpLimpio.length > 8) {
      return res.status(400).json({ error: 'CP de destino inválido', opciones: [] });
    }

    // ── Validación de peso — entre 1g y 100kg ───────────────────────
    const pesoKgNum = Number(pesoKg) || 0.5;
    if (pesoKgNum <= 0 || pesoKgNum > 100) {
      return res.status(400).json({ error: 'Peso fuera de rango permitido', opciones: [] });
    }

    // ── Validación de dimensiones — entre 1 y 150cm ─────────────────
    const dimH = Math.min(150, Math.max(1, Math.round(Number(dims?.height) || 10)));
    const dimW = Math.min(150, Math.max(1, Math.round(Number(dims?.width)  || 15)));
    const dimL = Math.min(150, Math.max(1, Math.round(Number(dims?.length) || 20)));

    const rawId     = process.env.CORREO_CUSTOMER_ID || '';
    const CUSTOMER_ID = rawId.padStart(10, '0');
    const CP_ORIGEN   = process.env.CORREO_CP_ORIGEN || '4107';

    if (!process.env.CORREO_USER || !process.env.CORREO_PASS || !rawId) {
      return res.status(200).json({ error: 'Servicio de envíos no disponible', opciones: [] });
    }

    const pesoGramos  = Math.max(1, Math.round(pesoKgNum * 1000));
    const cpOrigenNum = String(CP_ORIGEN).replace(/[^0-9]/g, '');

    const token = await getToken();

    const body = JSON.stringify({
      customerId:            String(CUSTOMER_ID),
      postalCodeOrigin:      cpOrigenNum,
      postalCodeDestination: cpLimpio,
      deliveredType:         'D',
      dimensions: {
        weight: pesoGramos,
        height: dimH,
        width:  dimW,
        length: dimL,
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
        error: `Sin cotización disponible para CP ${cpLimpio}`,
        opciones: []
      });
    }

    const opciones = result.rates.map((r, i) => ({
      id:          `correo-${r.deliveredType === 'D' ? 'domicilio' : 'sucursal'}-${i}`,
      nombre:      `Correo Argentino — ${r.productName || 'Clásico'}`,
      descripcion: `Correo Argentino · Entrega a domicilio`,
      precio:      Math.round(r.price),
    }));

    return res.status(200).json({ opciones });

  } catch(err) {
    // No exponer detalles internos del error
    console.error('cotizar-envio error:', err.message);
    return res.status(200).json({ error: 'No se pudo cotizar el envío', opciones: [] });
  }
};

function request(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve({ parseError: true }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (body) req.write(body);
    req.end();
  });
}
