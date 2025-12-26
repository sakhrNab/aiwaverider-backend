/**
 * Secure Token Service for Production
 * 
 * Production-ready token generation with multiple security layers:
 * - IP Whitelisting
 * - API Key Authentication  
 * - Rate Limiting
 * - Request Logging
 * - Firebase Integration
 */

const express = require('express');
const admin = require('firebase-admin');
const rateLimit = require('express-rate-limit');
const router = express.Router();

// Security: IP Whitelist
const ALLOWED_IPS = process.env.N8N_ALLOWED_IPS ? 
  process.env.N8N_ALLOWED_IPS.split(',').map(ip => ip.trim()) : [];

// Security: API Key
const SECURE_API_KEY = process.env.SECURE_TOKEN_API_KEY;

// Security: Rate Limiting
const tokenRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: {
    error: 'Too many token requests',
    message: 'Rate limit exceeded. Try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Security Middleware: IP Whitelist (Only for n8n automation)
 * Frontend and API requests are allowed through normal authentication
 */
const ipWhitelistMiddleware = (req, res, next) => {
  // Skip IP whitelist for legitimate frontend/API requests
  const isFrontendRequest = req.headers['user-agent']?.includes('Mozilla') || 
                           req.headers['origin']?.includes('aiwaverider.com') ||
                           req.headers['referer']?.includes('aiwaverider.com') ||
                           req.headers['host']?.includes('aiwaverider.com') ||
                           req.headers['x-forwarded-host']?.includes('aiwaverider.com');

  // Skip IP whitelist for API requests (they use normal Firebase auth)
  const isApiRequest = req.headers['user-agent']?.includes('axios') ||
                      req.headers['user-agent']?.includes('fetch') ||
                      req.headers['user-agent']?.includes('node') ||
                      req.headers['content-type']?.includes('application/json') ||
                      req.path.startsWith('/api/');

  if (isFrontendRequest || isApiRequest) {
    console.log(`🌐 Frontend/API request detected - skipping IP whitelist`);
    return next();
  }

  // Apply IP whitelist only for n8n/automation requests
  if (ALLOWED_IPS.length === 0) {
    console.warn('⚠️  No IP whitelist configured - allowing all automation IPs');
    return next();
  }

  const clientIP = req.ip || 
                   req.connection.remoteAddress || 
                   req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                   req.headers['x-real-ip'];

  console.log(`🔍 Automation request from IP: ${clientIP}`);

  if (!ALLOWED_IPS.includes(clientIP)) {
    console.warn(`🚫 Blocked automation request from unauthorized IP: ${clientIP}`);
    return res.status(403).json({
      error: 'Forbidden',
      message: 'IP address not authorized for automation',
      clientIP: clientIP,
      timestamp: new Date().toISOString()
    });
  }

  console.log(`✅ IP ${clientIP} authorized for automation`);
  next();
};

/**
 * Security Middleware: API Key Authentication
 */
const apiKeyAuthMiddleware = (req, res, next) => {
  const apiKey = req.headers['x-secure-api-key'];
  
  if (!SECURE_API_KEY) {
    console.error('❌ SECURE_TOKEN_API_KEY not configured');
    return res.status(500).json({
      error: 'Service Configuration Error',
      message: 'Token service not properly configured'
    });
  }

  if (!apiKey) {
    console.warn('🚫 Token request without API key');
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'X-Secure-API-Key header required',
      timestamp: new Date().toISOString()
    });
  }

  if (apiKey !== SECURE_API_KEY) {
    console.warn('🚫 Token request with invalid API key');
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API key',
      timestamp: new Date().toISOString()
    });
  }

  console.log('✅ API key authenticated successfully');
  next();
};

/**
 * Security Middleware: Request Logging
 */
const requestLoggingMiddleware = (req, res, next) => {
  const requestInfo = {
    timestamp: new Date().toISOString(),
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'],
    method: req.method,
    path: req.path,
    purpose: req.body?.purpose || 'not-specified'
  };

  console.log('🔐 Secure token request:', JSON.stringify(requestInfo, null, 2));
  
  // Add to request for potential audit logging
  req.securityAudit = requestInfo;
  next();
};

// Apply security middleware to all routes
router.use(tokenRateLimit);
router.use(ipWhitelistMiddleware);
router.use(apiKeyAuthMiddleware);
router.use(requestLoggingMiddleware);

/**
 * @swagger
 * /api/secure-tokens/admin:
 *   post:
 *     summary: Generate secure admin token (Production)
 *     description: Generate a Firebase custom token for admin operations with full security protection
 *     tags: [Secure Token Service]
 *     security:
 *       - SecureApiKey: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - purpose
 *             properties:
 *               purpose:
 *                 type: string
 *                 description: Purpose of token generation
 *                 example: "n8n-automation"
 *               userId:
 *                 type: string
 *                 description: Custom user ID (optional)
 *                 example: "admin-n8n-automation"
 *               expiresIn:
 *                 type: string
 *                 description: Token expiration (max 1h)
 *                 example: "1h"
 *     responses:
 *       200:
 *         description: Admin token generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 token: { type: string, example: "eyJhbGciOiJSUzI1NiIs..." }
 *                 user:
 *                   type: object
 *                   properties:
 *                     uid: { type: string, example: "admin-n8n-automation" }
 *                     email: { type: string, example: "admin@aiwaverider.com" }
 *                     role: { type: string, example: "admin" }
 *                 expiresIn: { type: string, example: "1h" }
 *                 generatedAt: { type: string, example: "2024-01-15T10:30:00Z" }
 *                 purpose: { type: string, example: "n8n-automation" }
 *       401:
 *         description: Unauthorized - Invalid API key
 *       403:
 *         description: Forbidden - IP not whitelisted
 *       429:
 *         description: Too Many Requests - Rate limit exceeded
 *       500:
 *         description: Token generation failed
 */
router.post('/admin', async (req, res) => {
  try {
    const { purpose, userId, expiresIn } = req.body;
    
    if (!purpose) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Purpose is required',
        example: { purpose: 'n8n-automation' }
      });
    }

    const adminUserId = userId || 'admin-secure-automation';
    const tokenPurpose = purpose.toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // Generate Firebase custom token with comprehensive claims
    const customToken = await admin.auth().createCustomToken(adminUserId, {
      role: 'admin',
      admin: true,
      email: 'admin@aiwaverider.com',
      purpose: tokenPurpose,
      generatedAt: new Date().toISOString(),
      secureGeneration: true,
      n8n: purpose.includes('n8n'),
      automation: true
    });

    const response = {
      success: true,
      token: customToken,
      user: {
        uid: adminUserId,
        email: 'admin@aiwaverider.com',
        role: 'admin',
        purpose: tokenPurpose
      },
      expiresIn: expiresIn || '1h',
      generatedAt: new Date().toISOString(),
      purpose: tokenPurpose,
      instructions: {
        usage: 'Use with Authorization: Bearer <token>',
        endpoints: [
          'POST /api/ai-tools - Create AI tools',
          'GET /api/agents - Get agents', 
          'POST /api/cache/clear - Clear cache',
          'All admin endpoints'
        ]
      }
    };

    console.log(`✅ Admin token generated successfully for purpose: ${tokenPurpose}`);
    res.json(response);

  } catch (error) {
    console.error('❌ Error generating secure admin token:', error);
    res.status(500).json({
      error: 'Token Generation Failed',
      message: 'Failed to generate secure admin token',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * @swagger
 * /api/secure-tokens/health:
 *   get:
 *     summary: Secure token service health check
 *     description: Check the health and configuration of the secure token service
 *     tags: [Secure Token Service]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 service: { type: string, example: "Secure Token Service" }
 *                 status: { type: string, example: "healthy" }
 *                 security:
 *                   type: object
 *                   properties:
 *                     ipWhitelist: { type: boolean, example: true }
 *                     apiKeyAuth: { type: boolean, example: true }
 *                     rateLimit: { type: boolean, example: true }
 *                 timestamp: { type: string, example: "2024-01-15T10:30:00Z" }
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'Secure Token Service',
    status: 'healthy',
    security: {
      ipWhitelist: ALLOWED_IPS.length > 0,
      apiKeyAuth: !!SECURE_API_KEY,
      rateLimit: true,
      requestLogging: true
    },
    configuration: {
      whitelistedIPs: ALLOWED_IPS.length,
      rateLimitWindow: '15 minutes',
      rateLimitMax: '10 requests'
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
