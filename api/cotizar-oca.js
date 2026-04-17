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

    const CUIT       = process.env.OCA_CUIT       || '23-43290240-4';
    const OPERATIVA  = process.env.OCA_OPERATIVA   || '466210';
    const CP_ORIGEN  = process.env.OCA_CP_ORIGEN   || '4107';

    const peso     = Math.max(0.1, Number(pesoKg) || 0.5);
    const volumen  = Math.max(0.0001, parseFloat((peso * 0.001).toFixed(4)));

    // Calcular valor declarado como 10% del peso en gramos (estimado)
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

    // La respuesta de OCA es XML — parsear precio
    if (!result || result.includes('Error') || result.includes('error')) {
      return res.status(200).json({ error: 'Sin cotización OCA para ese CP', opciones: [], raw: result?.substring(0, 200) });
    }

    // Extraer precio del XML — devolver campos encontrados para diagnóstico
    const precioMatch = result.match(/<Total>([\d.]+)<\/Total>/);
    const diasMatch   = result.match(/<Plazo>(\d+)<\/Plazo>/);
    
    // Buscar otros posibles campos de precio
    const tagMatches = [...result.matchAll(/<(\w+)>([\d.]+)<\/\1>/g)].map(m => `${m[1]}:${m[2]}`).join(', ');

    if (!precioMatch) {
      return res.status(200).json({ 
        error: 'No se pudo leer el precio', 
        opciones: [], 
        campos_numericos: tagMatches,
        xml_parte: result.substring(result.indexOf('<NewDataSet'), result.indexOf('<NewDataSet') + 500)
      });
    }

    const precio = Math.round(parseFloat(precioMatch[1]));
    const dias   = diasMatch ? diasMatch[1] : '?';

    const opciones = [{
      id:          'oca-pap',
      nombre:      'OCA — Puerta a Puerta',
      descripcion: `OCA PaP · Entrega a domicilio · ${peso.toFixed(2)}kg`,
      precio,
    }];

    return res.status(200).json({ opciones });

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
