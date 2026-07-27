// middleware.mjs — Routing Middleware (Vercel Edge, runtime: 'edge' por defecto)
//
// Problema que resuelve: el sitio es una SPA (todo vive en index.html y se arma
// con JS). Los crawlers que NO ejecutan JavaScript (WhatsApp, Facebook, Twitter,
// LinkedIn, Bing, etc.) reciben siempre el HTML genérico de la home, aunque la
// URL sea de un producto/categoría/página puntual — por eso, por ejemplo, compartir
// un link de producto por WhatsApp mostraba la imagen y el título genéricos.
//
// Esta Middleware NO toca nada para usuarios reales (se van directo al SPA de
// siempre). Solo para bots conocidos: busca los datos reales (producto en
// Firebase, o texto fijo para categoría/página) y reescribe <title>, meta
// description, Open Graph, Twitter Card, canonical y JSON-LD antes de servir
// el HTML — así cada URL indexable tiene su propio contenido real desde la
// primera respuesta, sin depender de que el bot ejecute JS.
//
// IMPORTANTE: los textos de PAGE_SEO de acá abajo están duplicados a propósito
// de PAGE_SEO en index.html (aplicarSeoPagina). Si cambiás el texto de
// "Nosotros" o "Servicio Técnico" ahí, actualizalo acá también.

export const config = {
  matcher: '/',
};

const SITE = 'https://ufobikeshop.com.ar';

// Bots/crawlers que no ejecutan JS (o cuyo preview depende del HTML crudo).
// Googlebot y Bingbot están incluidos igual: no cuesta nada darles el HTML ya
// resuelto, aunque hoy en día sí ejecutan JS en una segunda pasada.
const BOT_UA_REGEX =
  /googlebot|bingbot|yandexbot|duckduckbot|baiduspider|applebot|facebookexternalhit|facebookcatalog|twitterbot|linkedinbot|slackbot|telegrambot|whatsapp|discordbot|pinterest|redditbot|embedly|quora link preview|vkshare|w3c_validator/i;

const CAT_SEO = {
  bicicletas:   { name: 'Bicicletas',              desc: 'Bicicletas MTB, de ruta y urbanas en Yerba Buena, Tucumán.' },
  componentes:  { name: 'Componentes',             desc: 'Componentes para bicicletas: grupos, frenos, suspensión y más, en Tucumán.' },
  repuestos:    { name: 'Repuestos',                desc: 'Repuestos originales y compatibles para bicicletas en Tucumán.' },
  accesorios:   { name: 'Accesorios',               desc: 'Accesorios para ciclismo: luces, portabultos, botellas y más, en Tucumán.' },
  lubricantes:  { name: 'Lubricantes',              desc: 'Lubricantes y productos de mantenimiento para tu bicicleta en Tucumán.' },
  indumentaria: { name: 'Indumentaria',             desc: 'Indumentaria de ciclismo y MTB en Yerba Buena, Tucumán.' },
  protecciones: { name: 'Protecciones',             desc: 'Cascos y protecciones para ciclismo y MX en Tucumán.' },
  'mx-enduro':  { name: 'MX y Enduro',              desc: 'Equipamiento e indumentaria de motocross y enduro en Tucumán.' },
  usados:       { name: 'Usados',                   desc: 'Bicicletas y equipamiento usado, revisado, en Yerba Buena, Tucumán.' },
};

const PAGE_SEO = {
  about: {
    title: 'Nosotros — UFO Bike Shop | Bicicletería en Yerba Buena, Tucumán',
    desc:  'Conocé UFO Bike Shop: bicicletería especializada en Yerba Buena, Tucumán. Calidad, asesoría experta y envíos a todo el país desde 9 de Julio 718.'
  },
  service: {
    title: 'Servicio Técnico de Bicicletas en Yerba Buena, Tucumán | UFO Bike Shop',
    desc:  'Técnicos especializados en mantenimiento y reparación de bicicletas en Yerba Buena, Tucumán. Service completo, armado de bicis y ruedas a medida. Pedí tu turno por WhatsApp.'
  }
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Mismo criterio de transformación de imagen que cldUrl() en index.html
function cldOgImage(url) {
  if (!url || typeof url !== 'string' || !url.includes('res.cloudinary.com')) {
    return `${SITE}/og-image.jpg`;
  }
  if (url.includes('/upload/f_') || url.includes('/upload/q_') || url.includes('/upload/w_')) {
    return url;
  }
  return url.replace('/upload/', '/upload/f_auto,q_auto,w_1200/');
}

async function getProductoSeo(id) {
  // Mismo patrón que /api/products.js y /api/sitemap.js: la lectura de Firebase
  // es pública, el secret es opcional (solo se agrega si está configurado).
  const firebaseUrl = process.env.FIREBASE_URL || 'https://ufobikeshop-default-rtdb.firebaseio.com';
  const firebaseSecret = process.env.FIREBASE_SECRET;

  try {
    const authParam = firebaseSecret ? `?auth=${firebaseSecret}` : '';
    const res = await fetch(`${firebaseUrl}/products/${encodeURIComponent(id)}.json${authParam}`);
    if (!res.ok) return null;
    const p = await res.json();
    if (!p || !p.name) return null;

    const priceFmt = typeof p.price === 'number' ? `$${p.price.toLocaleString('es-AR')}` : '';
    const title = `${p.name} — UFO Bike Shop Tucumán`;
    const desc = (p.desc || p.name) + (priceFmt
      ? ` — ${priceFmt}. Comprá online en UFO Bike Shop, bicicletería en Yerba Buena, Tucumán.`
      : ' — UFO Bike Shop, bicicletería en Yerba Buena, Tucumán.');

    return {
      title,
      desc,
      image: cldOgImage(p.photo),
      url: `${SITE}/?producto=${encodeURIComponent(id)}`,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.name,
        description: p.desc || p.name,
        image: cldOgImage(p.photo),
        offers: {
          '@type': 'Offer',
          priceCurrency: 'ARS',
          price: p.price,
          availability: 'https://schema.org/InStock',
          url: `${SITE}/?producto=${encodeURIComponent(id)}`
        }
      }
    };
  } catch {
    return null;
  }
}

function getCategoriaSeo(cat) {
  const c = CAT_SEO[cat];
  if (!c) return null;
  return {
    title: `${c.name} — UFO Bike Shop | Bicicletería en Tucumán`,
    desc: c.desc,
    image: `${SITE}/og-image.jpg`,
    url: `${SITE}/?cat=${cat}`,
    jsonLd: null
  };
}

function getPaginaSeo(page) {
  const p = PAGE_SEO[page];
  if (!p) return null;
  return {
    title: p.title,
    desc: p.desc,
    image: `${SITE}/og-image.jpg`,
    url: `${SITE}/?page=${page}`,
    jsonLd: null
  };
}

function inyectarSeo(html, seo) {
  let out = html
    .replace(/<title>.*?<\/title>/s, `<title>${escapeHtml(seo.title)}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${escapeHtml(seo.desc)}$2`)
    .replace(/(<meta property="og:title"\s+content=")[^"]*(")/, `$1${escapeHtml(seo.title)}$2`)
    .replace(/(<meta property="og:description"\s+content=")[^"]*(")/, `$1${escapeHtml(seo.desc)}$2`)
    .replace(/(<meta property="og:url"\s+content=")[^"]*(")/, `$1${escapeHtml(seo.url)}$2`)
    .replace(/(<meta property="og:image"\s+content=")[^"]*(")/, `$1${escapeHtml(seo.image)}$2`)
    .replace(/(<meta name="twitter:title"\s+content=")[^"]*(")/, `$1${escapeHtml(seo.title)}$2`)
    .replace(/(<meta name="twitter:description"\s+content=")[^"]*(")/, `$1${escapeHtml(seo.desc)}$2`)
    .replace(/(<meta name="twitter:image"\s+content=")[^"]*(")/, `$1${escapeHtml(seo.image)}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${escapeHtml(seo.url)}$2`);

  if (seo.jsonLd) {
    const script = `<script type="application/ld+json">${JSON.stringify(seo.jsonLd)}</script>\n</head>`;
    out = out.replace('</head>', script);
  }
  return out;
}

export default async function middleware(request) {
  // Red de seguridad: esta Middleware corre en CADA visita a la home (bots y
  // gente real). Cualquier error inesperado acá NUNCA debe tirar abajo el
  // sitio — ante la duda, dejamos pasar el request normal (undefined).
  try {
    const ua = request.headers.get('user-agent') || '';
    if (!BOT_UA_REGEX.test(ua)) return; // usuario real: SPA de siempre, no tocar nada

    const url = new URL(request.url);
    const producto = url.searchParams.get('producto');
    const cat = url.searchParams.get('cat');
    const page = url.searchParams.get('page');
    if (!producto && !cat && !page) return; // home: ya tiene buen SEO estático

    let seo = null;
    if (producto) seo = await getProductoSeo(producto);
    else if (cat) seo = getCategoriaSeo(cat);
    else if (page) seo = getPaginaSeo(page);
    if (!seo) return; // no encontramos datos reales: mejor servir el HTML normal

    // Pedimos el index.html estático tal cual lo serviría Vercel, para no
    // duplicar el layout acá. Path distinto a '/' para no volver a pasar por
    // esta misma Middleware (el matcher solo escucha '/').
    const originRes = await fetch(new URL('/index.html', url.origin));
    if (!originRes.ok) return;
    const html = await originRes.text();

    return new Response(inyectarSeo(html, seo), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=600, s-maxage=600',
        'x-robots-tag': 'index, follow',
      },
    });
  } catch (e) {
    console.error('middleware SEO error, sirviendo la página normal:', e);
    return;
  }
}
