// backend/middleware/cache.js

/**
 * Cache control middleware for handling HTTP caching headers
 * @param {number} duration - Cache duration in seconds
 * @returns {Function} Express middleware
 */
const cacheControl = (duration = 300) => (req, res, next) => {
  // Skip caching for authenticated routes or non-GET requests
  if (req.headers.authorization || req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return next();
  }

  // Comprehensive list of endpoints that should never be cached
  const noCacheEndpoints = [
    '/api/auth',
    '/api/profile',
    '/api/users/me',
    '/api/users/',
    '/api/user/',
    '/api/wishlists',
    '/api/cart',
    '/api/checkout',
    '/api/payments',
    '/api/admin',
    '/api/chat',
    '/api/upload',
    '/api/session',
    '/api/tokens',
    '/api/email',
    '/api/notifications',
    '/api/favorites',
    '/api/subscriptions',
    '/api/settings',
    '/api/community'
  ];

  // Check if the request path matches any no-cache endpoint
  const shouldNotCache = noCacheEndpoints.some(endpoint => {
    return req.path === endpoint || req.path.startsWith(endpoint);
  });

  if (shouldNotCache) {
    console.log(`[CacheControl] No-cache headers for: ${req.path}`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return next();
  }

  // Additional patterns for user-specific or dynamic content
  const dynamicContentPatterns = [
    /\/users?\/[^\/]+/,    // /user/123 or /users/123
    /\/profile/,           // any profile routes
    /\/account/,           // any account routes
    /\/dashboard/,         // any dashboard routes
    /\/admin/,             // any admin routes
    /\/api\/.*\/me$/,      // any "me" endpoints
    /\/api\/.*\/\d+$/,     // endpoints ending with numbers (likely IDs)
    /\/search\?/,          // search queries
    /\/api\/.*\?.*user/,   // queries with user parameters
  ];

  const isDynamicContent = dynamicContentPatterns.some(pattern => pattern.test(req.originalUrl || req.path));
  
  if (isDynamicContent) {
    console.log(`[CacheControl] No-cache headers for dynamic content: ${req.path}`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return next();
  }

  // For public GET routes that can be cached
  console.log(`[CacheControl] Cache headers applied for: ${req.path} (${duration}s)`);
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

  // Skip ETag for dynamic or user-specific content
  const skipEtagEndpoints = [
    '/api/auth',
    '/api/profile',
    '/api/users',
    '/api/user',
    '/api/admin',
    '/api/chat'
  ];

  const shouldSkipEtag = skipEtagEndpoints.some(endpoint => 
    req.path.startsWith(endpoint)
  );

  if (shouldSkipEtag) {
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
  // Include Authorization to vary cache based on auth status
  res.setHeader('Vary', 'Origin, Accept-Encoding, User-Agent, Authorization');
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

  // Skip for authenticated or user-specific routes
  if (req.headers.authorization || req.path.includes('/profile') || req.path.includes('/user')) {
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