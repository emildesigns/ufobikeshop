// api/cotizar-envio.js — Zonas manuales de envío
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  // Las zonas se calculan en el frontend — este endpoint ya no se usa activamente
  return res.status(200).json({ opciones: [], mensaje: 'Usar zonas manuales del frontend' });
};
