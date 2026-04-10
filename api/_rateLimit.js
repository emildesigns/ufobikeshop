// api/_rateLimit.js — Rate limiting compartido entre endpoints
const rateLimitMap = new Map();

/**
 * Verifica si una IP excedió el límite de requests
 * @param {string} ip 
 * @param {number} maxRequests — máximo de requests permitidos
 * @param {number} windowMs — ventana de tiempo en ms
 * @returns {boolean} true si está bloqueado
 */
function checkRateLimit(ip, maxRequests = 20, windowMs = 60000) {
  const now  = Date.now();
  const key  = ip || 'unknown';
  const data = rateLimitMap.get(key) || { count: 0, resetAt: now + windowMs };

  // Resetear si venció la ventana
  if (now > data.resetAt) {
    data.count   = 0;
    data.resetAt = now + windowMs;
  }

  data.count++;
  rateLimitMap.set(key, data);

  // Limpiar entradas viejas cada 1000 IPs para no acumular memoria
  if (rateLimitMap.size > 1000) {
    for (const [k, v] of rateLimitMap) {
      if (now > v.resetAt) rateLimitMap.delete(k);
    }
  }

  return data.count > maxRequests;
}

function getIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
      || req.headers['x-real-ip']
      || 'unknown';
}

module.exports = { checkRateLimit, getIP };
