// /api/merchant-feed.js
// Feed de productos para Google Merchant Center (listados gratuitos de Shopping)
// Genera el XML al vuelo leyendo los productos desde Firebase, igual que /api/sitemap.js
// Google lo lee en https://ufobikeshop.com.ar/merchant-feed.xml (carga programada)

const SITE = 'https://ufobikeshop.com.ar';

// Mapeo de categorías propias -> etiqueta legible + categoría oficial de Google (cuando la sabemos con certeza)
const CATEGORY_INFO = {
  bicicletas:   { label: 'Bicicletas',    googleCat: 'Sporting Goods > Outdoor Recreation > Cycling > Bicycles' },
  componentes:  { label: 'Componentes',   googleCat: 'Sporting Goods > Outdoor Recreation > Cycling > Bicycle Parts' },
  repuestos:    { label: 'Repuestos',     googleCat: 'Sporting Goods > Outdoor Recreation > Cycling > Bicycle Parts' },
  accesorios:   { label: 'Accesorios',    googleCat: 'Sporting Goods > Outdoor Recreation > Cycling > Bicycle Accessories' },
  lubricantes:  { label: 'Lubricantes',   googleCat: null },
  indumentaria: { label: 'Indumentaria',  googleCat: null },
  protecciones: { label: 'Protecciones',  googleCat: 'Sporting Goods > Outdoor Recreation > Cycling > Bicycle Accessories > Bicycle Helmets' },
  'mx-enduro':  { label: 'MX y Enduro',   googleCat: null },
  usados:       { label: 'Usados',        googleCat: null },
};

function xmlEscape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hasStock(product) {
  if (product.sizes && Object.keys(product.sizes).length > 0) {
    return Object.values(product.sizes).some(s => Number(s) > 0);
  }
  if (product.stock !== undefined && product.stock !== null) {
    return Number(product.stock) > 0;
  }
  return true; // sin dato de stock: asumimos disponible, igual que el sitemap
}

function money(n) {
  return `${Number(n).toFixed(2)} ARS`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }

  let products = {};
  try {
    const firebaseUrl = process.env.FIREBASE_URL;
    const firebaseSecret = process.env.FIREBASE_SECRET;
    if (firebaseUrl && firebaseSecret) {
      const url = `${firebaseUrl}/products.json?auth=${firebaseSecret}`;
      const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
      if (response.ok) {
        const data = await response.json();
        if (data && typeof data === 'object') products = data;
      }
    }
  } catch (err) {
    console.error('Error fetching products for merchant feed:', err);
  }

  const items = Object.entries(products)
    .filter(([id, p]) => p && p.name && Number(p.price) > 0)
    .map(([id, p]) => {
      const photos = [p.photo, p.photo2, p.photo3, ...(Array.isArray(p.photos) ? p.photos : [])].filter(Boolean);
      if (photos.length === 0) return null;

      const catInfo = CATEGORY_INFO[p.cat] || null;
      const condition = p.cat === 'usados' ? 'used' : 'new';
      const onSale = p.oldPrice && Number(p.oldPrice) > Number(p.price);
      const description = (p.detail || p.desc || p.name || '').slice(0, 5000);

      const fields = [
        `<g:id>${xmlEscape(id)}</g:id>`,
        `<g:title>${xmlEscape(p.name)}</g:title>`,
        `<g:description>${xmlEscape(description)}</g:description>`,
        `<link>${xmlEscape(`${SITE}/?producto=${encodeURIComponent(id)}`)}</link>`,
        `<g:image_link>${xmlEscape(photos[0])}</g:image_link>`,
        ...photos.slice(1, 11).map(url => `<g:additional_image_link>${xmlEscape(url)}</g:additional_image_link>`),
        `<g:availability>${hasStock(p) ? 'in stock' : 'out of stock'}</g:availability>`,
        `<g:price>${money(onSale ? p.oldPrice : p.price)}</g:price>`,
        ...(onSale ? [`<g:sale_price>${money(p.price)}</g:sale_price>`] : []),
        `<g:condition>${condition}</g:condition>`,
        `<g:identifier_exists>no</g:identifier_exists>`,
        `<g:product_type>${xmlEscape(catInfo ? catInfo.label : (p.cat || ''))}</g:product_type>`,
        ...(catInfo && catInfo.googleCat ? [`<g:google_product_category>${xmlEscape(catInfo.googleCat)}</g:google_product_category>`] : []),
      ];

      return `  <item>\n    ${fields.join('\n    ')}\n  </item>`;
    })
    .filter(Boolean);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
<channel>
  <title>UFO Bike Shop — Catálogo de productos</title>
  <link>${SITE}</link>
  <description>Bicicletas, componentes, repuestos y accesorios — UFO Bike Shop, Yerba Buena, Tucumán</description>
${items.join('\n')}
</channel>
</rss>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.status(200).send(xml);
}
