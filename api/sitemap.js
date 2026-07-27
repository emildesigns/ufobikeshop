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
  'lubricantes',
  'indumentaria',
  'protecciones',
  'mx-enduro',
  'usados'
];

// Fecha real del último cambio de contenido de gracias.html (no autogenerada — actualizar a mano si se edita)
const GRACIAS_LASTMOD = '2026-04-12';

// Páginas de contenido propio, indexables vía ?page=xxx (ver aplicarSeoPagina() en index.html).
// lastmod fijo: actualizar a mano cuando cambie el texto real de la sección.
const CONTENT_PAGES = [
  { slug: 'about',   lastmod: '2026-07-26', priority: '0.6' },
  { slug: 'service', lastmod: '2026-07-26', priority: '0.6' }
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

  // updatedAt (ISO) -> YYYY-MM-DD, o null si no lo tenemos.
  // Los productos viejos no tienen updatedAt todavía (se agregó recién) — en ese caso
  // omitimos <lastmod> en vez de mentir con la fecha de hoy: es lo que recomienda Google.
  function lastmodDe(product) {
    if (!product || !product.updatedAt) return null;
    const d = new Date(product.updatedAt);
    return isNaN(d) ? null : d.toISOString().split('T')[0];
  }

  // Construir las URLs
  const urls = [];

  // 1. Home (prioridad máxima) — lastmod=hoy es legítimo, el catálogo cambia a diario
  urls.push({
    loc: `${SITE}/`,
    lastmod: today,
    changefreq: 'daily',
    priority: '1.0'
  });

  // 2. Página de gracias (baja prioridad pero existe)
  urls.push({
    loc: `${SITE}/gracias.html`,
    lastmod: GRACIAS_LASTMOD,
    changefreq: 'monthly',
    priority: '0.3'
  });

  // 3. Páginas de contenido propio (Nosotros / Servicio Técnico)
  CONTENT_PAGES.forEach(page => {
    urls.push({
      loc: `${SITE}/?page=${page.slug}`,
      lastmod: page.lastmod,
      changefreq: 'monthly',
      priority: page.priority
    });
  });

  // 4. Categorías (alta prioridad — son páginas de entrada importantes)
  // lastmod = la fecha más reciente entre los productos de esa categoría (si la conocemos)
  CATEGORIES.forEach(cat => {
    const productosCat = Object.values(products).filter(p => p && p.cat === cat);
    const fechas = productosCat.map(lastmodDe).filter(Boolean).sort();
    const lastmod = fechas.length ? fechas[fechas.length - 1] : null;

    urls.push({
      loc: `${SITE}/?cat=${cat}`,
      lastmod,
      changefreq: 'weekly',
      priority: '0.8'
    });
  });

  // 5. Productos individuales
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
      lastmod: lastmodDe(product),
      changefreq: 'weekly',
      priority: hasStock ? '0.7' : '0.4'
    });
  });

  // Generar XML — <lastmod> solo se incluye cuando conocemos la fecha real
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${xmlEscape(u.loc)}</loc>
${u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : ''}    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  // Headers correctos para que Google y otros crawlers lo entiendan como sitemap
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  // Cacheamos 1 hora en CDN (Google no consulta el sitemap todo el tiempo)
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.status(200).send(xml);
}
