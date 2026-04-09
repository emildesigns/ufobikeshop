// api/cotizar-envio.js — Correo Argentino API MiCorreo v1
const https = require('https');

let tokenCache = { token: null, expires: null };

// Mapa de prefijos de provincia según códigos postales argentinos
function normalizarCP(cp) {
  const n = parseInt(cp);
  if (n >= 1000 && n <= 1499) return `C${cp}`; // CABA
  if (n >= 1500 && n <= 1999) return `B${cp}`; // GBA
  if (n >= 2000 && n <= 2999) return `S${cp}`; // Santa Fe
  if (n >= 3000 && n <= 3499) return `S${cp}`; // Santa Fe / Entre Ríos
  if (n >= 3500 && n <= 3999) return `E${cp}`; // Entre Ríos / Corrientes
  if (n >= 4000 && n <= 4199) return `T${cp}`; // Tucumán
  if (n >= 4200 && n <= 4399) return `T${cp}`; // Tucumán / Catamarca
  if (n >= 4400 && n <= 4599) return `A${cp}`; // Salta
  if (n >= 4600 && n <= 4799) return `Y${cp}`; // Jujuy
  if (n >= 5000 && n <= 5499) return `X${cp}`; // Córdoba
  if (n >= 5500 && n <= 5599) return `M${cp}`; // Mendoza
  if (n >= 5600 && n <= 5799) return `D${cp}`; // San Luis
  if (n >= 5800 && n <= 5999) return `X${cp}`; // Córdoba
  if (n >= 6000 && n <= 6499) return `B${cp}`; // Buenos Aires prov.
  if (n >= 6500 && n <= 6999) return `L${cp}`; // La Pampa
  if (n >= 7000 && n <= 7999) return `B${cp}`; // Buenos Aires prov.
  if (n >= 8000 && n <= 8499) return `Q${cp}`; // Neuquén / Río Negro
  if (n >= 8500 && n <= 8799) return `R${cp}`; // Río Negro
  if (n >= 8800 && n <= 8999) return `U${cp}`; // Chubut
  if (n >= 9000 && n <= 9299) return `Z${cp}`; // Santa Cruz
  if (n >= 9300 && n <= 9499) return `V${cp}`; // Tierra del Fuego
  // Si no coincide, devolver tal cual
  return cp;
}

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

    if (!cpDestino || cpDestino.length < 4) {
      return res.status(400).json({ error: 'CP de destino inválido' });
    }

    const CUSTOMER_ID = process.env.CORREO_CUSTOMER_ID;
    const CP_ORIGEN   = process.env.CORREO_CP_ORIGEN || '4107';

    if (!process.env.CORREO_USER || !process.env.CORREO_PASS || !CUSTOMER_ID) {
      return res.status(200).json({ error: 'Credenciales no configuradas', opciones: [] });
    }

    const pesoGramos  = Math.max(1, Math.round((pesoKg || 0.5) * 1000));
    const cpOrigenNorm  = normalizarCP(CP_ORIGEN);
    const cpDestinoNorm = normalizarCP(cpDestino);

    const token = await getToken();

    const body = JSON.stringify({
      customerId:            String(CUSTOMER_ID),
      postalCodeOrigin:      cpOrigenNorm,
      postalCodeDestination: cpDestinoNorm,
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
        error: `Sin cotización para CP ${cpDestinoNorm}`,
        opciones: []
      });
    }

    const opciones = result.rates.map(r => ({
      id:          r.deliveredType === 'D' ? 'correo-domicilio' : 'correo-sucursal',
      nombre:      r.deliveredType === 'D' ? 'Correo Argentino — Domicilio' : 'Correo Argentino — Sucursal',
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
