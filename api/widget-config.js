// /api/widget-config.js
// Devuelve la config del widget de CognitionDesk. La API key vive como env var
// en Vercel (COGNITIONDESK_API_KEY) para no quedar hardcodeada en el repo.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }

  res.setHeader('Cache-Control', 'no-store');

  const apiKey = process.env.COGNITIONDESK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'COGNITIONDESK_API_KEY no configurada' });
  }

  return res.status(200).json({
    apiKey,
    widgetId: 'widget_EyPH28gS6oetQv80B8vAYJ6zp3H3_1784415770215'
  });
}
