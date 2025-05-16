/**
 * Cache control middleware for handling HTTP caching headers
 * @param {number} duration - Cache duration in seconds
 * @returns {Function} Express middleware
 */
const cacheControl = (duration = 300) => (req, res, next) => {
  // Skip caching for authenticated routes or non-GET requests
  if (req.headers.authorization || req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return next();
  }

  // Skip caching for specific endpoints
  const noCacheEndpoints = [
    '/api/auth',
    '/api/profile',
    '/api/users/me',
  ];

  if (noCacheEndpoints.some(endpoint => req.path.startsWith(endpoint))) {
    res.setHeader('Cache-Control', 'no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return next();
  }

  // For public GET routes that can be cached
  res.setHeader('Cache-Control', `public, max-age=${duration}, stale-while-revalidate=60`);
  next();
};

/**
 * Middleware to handle ETag caching
 */
const etagCache = () => (req, res, next) => {
  // Skip for non-GET requests or authenticated routes
  if (req.method !== 'GET' || req.headers.authorization) {
    return next();
  }

  // Enable ETag for responses
  res.setHeader('ETag', true);
  
  // Check if client sent If-None-Match
  const clientEtag = req.headers['if-none-match'];
  if (clientEtag) {
    res.setHeader('If-None-Match', clientEtag);
  }

  next();
};

/**
 * Middleware to handle Vary header
 */
const varyHeader = () => (req, res, next) => {
  // Set Vary header to handle different client capabilities
  // Include Origin in Vary header to ensure correct caching with CORS
  res.setHeader('Vary', 'Origin, Accept-Encoding, User-Agent');
  next();
};

/**
 * Middleware to handle conditional requests
 */
const conditionalGet = () => (req, res, next) => {
  // Skip for non-GET requests
  if (req.method !== 'GET') {
    return next();
  }

  // Handle If-Modified-Since
  const ifModifiedSince = req.headers['if-modified-since'];
  if (ifModifiedSince) {
    res.setHeader('Last-Modified', new Date().toUTCString());
  }

  next();
};

module.exports = {
  cacheControl,
  etagCache,
  varyHeader,
  conditionalGet,
};
