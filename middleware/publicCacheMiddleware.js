// backend/middleware/publicCacheMiddleware.js
const { cacheControl, etagCache, varyHeader, conditionalGet } = require('./cache');

/**
 * Combined middleware for public caching that applies:
 * 1. Cache-Control headers with max-age and stale-while-revalidate
 * 2. ETag support for conditional requests
 * 3. Vary header for proper cache variation
 * 4. Conditional GET handling
 * 
 * @param {Object} options - Middleware options
 * @param {number} options.maxAge - Cache duration in seconds (default: 300)
 * @param {boolean} options.enableEtag - Whether to enable ETag (default: true)
 * @param {boolean} options.enableConditionalGet - Whether to enable conditional GET (default: true)
 * @returns {Function} Express middleware
 */
const publicCacheMiddleware = (options = {}) => {
  const {
    maxAge = 300,
    enableEtag = true,
    enableConditionalGet = true
  } = options;

  return (req, res, next) => {
    // Skip for non-GET requests or authenticated routes
    if (req.method !== 'GET' || req.headers.authorization) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return next();
    }

    // Comprehensive list of endpoints that shouldn't be cached
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
      '/api/email'
    ];

    // Check if the request path matches any no-cache endpoint
    const shouldNotCache = noCacheEndpoints.some(endpoint => {
      // Check both exact match and starts with for broader coverage
      return req.path === endpoint || req.path.startsWith(endpoint);
    });

    if (shouldNotCache) {
      console.log(`[Cache] Skipping cache for protected endpoint: ${req.path}`);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return next();
    }

    // Additional check for any paths containing user-specific data
    const userSpecificPatterns = [
      /\/users?\/[^\/]+/,  // /user/123 or /users/123
      /\/profile/,         // any profile routes
      /\/account/,         // any account routes
      /\/dashboard/,       // any dashboard routes
      /\/admin/,           // any admin routes
      /\/api\/.*\/me$/,    // any "me" endpoints
    ];

    const isUserSpecific = userSpecificPatterns.some(pattern => pattern.test(req.path));
    
    if (isUserSpecific) {
      console.log(`[Cache] Skipping cache for user-specific endpoint: ${req.path}`);
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      return next();
    }

    // Save original methods to restore them if they get overridden
    const originalSetHeader = res.setHeader;
    const originalWriteHead = res.writeHead;

    // Override setHeader to prevent overriding of CORS headers
    res.setHeader = function(name, value) {
      // Don't override CORS headers that are already set
      if (name === 'Access-Control-Allow-Origin' || 
          name === 'Access-Control-Allow-Methods' ||
          name === 'Access-Control-Allow-Headers' ||
          name === 'Access-Control-Allow-Credentials') {
        return originalSetHeader.apply(this, arguments);
      }
      
      return originalSetHeader.apply(this, arguments);
    };

    console.log(`[Cache] Applying cache headers for public endpoint: ${req.path}`);

    // Chain the middleware functions
    cacheControl(maxAge)(req, res, () => {
      if (enableEtag) {
        etagCache()(req, res, () => {
          varyHeader()(req, res, () => {
            if (enableConditionalGet) {
              conditionalGet()(req, res, next);
            } else {
              next();
            }
          });
        });
      } else {
        varyHeader()(req, res, next);
      }
    });
  };
};

module.exports = publicCacheMiddleware;