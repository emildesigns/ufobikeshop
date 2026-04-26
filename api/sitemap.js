// /api/sitemap.js
// Sitemap dinámico — genera XML con home, categorías y todos los productos desde Firebase
// Google lo lee en https://ufobikeshop.com.ar/sitemap.xml

const SITE = 'https://ufobikeshop.com.ar';

// Categorías estáticas del catálogo
const CATEGORIES = [
  'bicicletas',
  'componentes',
  'repuestos',
  'accesorios',
  'indumentaria',
  'protecciones',
  'mx-enduro'
];

// Función para escapar caracteres XML especiales en URLs
function xmlEscape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default async function handler(req, res) {
  // Solo permitimos GET
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  let products = {};

  // Intentamos leer productos desde Firebase
  try {
    const firebaseUrl = process.env.FIREBASE_URL;
    const firebaseSecret = process.env.FIREBASE_SECRET;

    if (firebaseUrl && firebaseSecret) {
      const url = `${firebaseUrl}/products.json?auth=${firebaseSecret}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        const data = await response.json();
        if (data && typeof data === 'object') {
          products = data;
        }
      }
    }
  } catch (err) {
    // Si falla Firebase, igual generamos el sitemap con home y categorías
    console.error('Error fetching products for sitemap:', err);
  }

  // Construir las URLs
  const urls = [];

  // 1. Home (prioridad máxima)
  urls.push({
    loc: `${SITE}/`,
    lastmod: today,
    changefreq: 'daily',
    priority: '1.0'
  });

  // 2. Página de gracias (baja prioridad pero existe)
  urls.push({
    loc: `${SITE}/gracias.html`,
    lastmod: today,
    changefreq: 'monthly',
    priority: '0.3'
  });

  // 3. Categorías (alta prioridad — son páginas de entrada importantes)
  CATEGORIES.forEach(cat => {
    urls.push({
      loc: `${SITE}/?cat=${cat}`,
      lastmod: today,
      changefreq: 'weekly',
      priority: '0.8'
    });
  });

  // 4. Productos individuales
  // products viene como objeto: { "id1": {name, price, ...}, "id2": {...} }
  Object.entries(products).forEach(([id, product]) => {
    if (!product || !product.name) return;

    // Verificar si tiene stock disponible (por talles o stock general)
    let hasStock = true;
    if (product.sizes && Object.keys(product.sizes).length > 0) {
      hasStock = Object.values(product.sizes).some(s => Number(s) > 0);
    } else if (product.stock !== undefined && product.stock !== null) {
      hasStock = Number(product.stock) > 0;
    }

    // Productos sin stock siguen en el sitemap pero con prioridad menor
    urls.push({
      loc: `${SITE}/?producto=${encodeURIComponent(id)}`,
      lastmod: today,
      changefreq: 'weekly',
      priority: hasStock ? '0.7' : '0.4'
    });
  });

  // Generar XML
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${xmlEscape(u.loc)}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  // Headers correctos para que Google y otros crawlers lo entiendan como sitemap
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  // Cacheamos 1 hora en CDN (Google no consulta el sitemap todo el tiempo)
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.status(200).send(xml);
}
