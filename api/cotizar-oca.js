// api/cotizar-oca.js — Integración OCA e-Pak cotización
const https = require('https');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://ufo-bikeshop.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const { cpDestino, pesoKg } = req.body;

    if (!cpDestino || cpDestino.length < 4) {
      return res.status(400).json({ error: 'CP inválido', opciones: [] });
    }

    const CUIT      = process.env.OCA_CUIT      || '20-35354825-6';
    const OPERATIVA = process.env.OCA_OPERATIVA  || '466210';
    const CP_ORIGEN = process.env.OCA_CP_ORIGEN  || '4107';

    const peso           = Math.max(0.1, Number(pesoKg) || 0.5);
    const volumen        = Math.max(0.0001, parseFloat((peso * 0.001).toFixed(4)));
    const valorDeclarado = Math.max(1000, Math.round(peso * 5000));

    const url = `https://webservice.oca.com.ar/ePak_tracking/Oep_TrackEPak.asmx/Tarifar_Envio_Corporativo?` +
      `Cuit=${encodeURIComponent(CUIT)}&` +
      `Operativa=${OPERATIVA}&` +
      `PesoTotal=${peso}&` +
      `VolumenTotal=${volumen}&` +
      `CodigoPostalOrigen=${CP_ORIGEN}&` +
      `CodigoPostalDestino=${cpDestino}&` +
      `CantidadPaquetes=1&` +
      `ValorDeclarado=${valorDeclarado}`;

    const result = await getURL(url);

    if (!result || result.includes('el cuit o la operativa son invalidos')) {
      return res.status(200).json({ error: 'CUIT u operativa inválidos', opciones: [] });
    }

    const totalMatch = result.match(/<total>([\d.]+)<\/total>/i);
    const plazoMatch = result.match(/<plazoentrega>(\d+)<\/plazoentrega>/i);

    if (!totalMatch) {
      return res.status(200).json({ error: 'Sin cotización disponible para ese CP', opciones: [] });
    }

    const precio = Math.round(parseFloat(totalMatch[1]));
    const plazo  = plazoMatch ? plazoMatch[1] : '';

    return res.status(200).json({
      opciones: [{
        id:          'oca-pap',
        nombre:      'OCA — Puerta a Puerta',
        descripcion: `OCA PaP · Entrega a domicilio · ${peso.toFixed(2)}kg${plazo ? ` · ${plazo} días hábiles` : ''}`,
        precio,
      }]
    });

  } catch(err) {
    console.error('cotizar-oca error:', err.message);
    return res.status(200).json({ error: 'No se pudo cotizar con OCA', opciones: [] });
  }
};

function getURL(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    https.get({
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      headers:  { 'Accept': 'application/xml, text/xml, */*' }
    }, r => {
      let raw = '';
      r.on('data', c => raw += c);
      r.on('end', () => resolve(raw));
    }).on('error', reject);
  });
}
