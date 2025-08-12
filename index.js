// backend/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const passport = require('passport');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const logger = require('./utils/logger');
const { initializePassport } = require('./config/passport');
const { db } = require('./config/firebase');
const { initializeSettings } = require('./models/siteSettings');
const uploadMiddleware = require('./middleware/upload');
const admin = require('firebase-admin');

// Initialize express
const app = express();

// Basic health check route - must be before ANY middleware
app.get('/_health', (_, res) => res.send('OK'));

// Environment variables
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';
const PORT = process.env.PORT || (isProduction ? 8080 : 4000);

// Initialize site settings
initializeSettings(db).catch(err => {
  logger.error('Failed to initialize site settings:', err);
});

// Make upload middleware available globally
app.locals.upload = uploadMiddleware;

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ------------------ CORS Configuration ------------------
const allowedOrigins = isProduction
  ? (process.env.CORS_ORIGINS || '').split(',').map(origin => origin.trim())
  : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:45977']; // Frontend origins

// Create a CORS middleware function with proper configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl requests, or same origin)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error(`CORS policy: Origin ${origin} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma'],
  credentials: true,
  maxAge: 86400 // 24 hours
};

// Log active CORS configuration
logger.info(`CORS configured with allowed origins: ${JSON.stringify(allowedOrigins)}`);
logger.info(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);

// Apply middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Add security headers
app.use(helmet());

// Session configuration - required for Passport
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Initialize Passport and restore authentication state from session
initializePassport(passport);
app.use(passport.initialize());
app.use(passport.session());

// ------------------ Rate Limiting ------------------
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  message: 'Too many requests, please try again in 15 minutes!',
});

// Apply rate limiting only in production or development
if (isProduction || isDevelopment) {
  app.use(limiter);
}

// Add rate limiting specifically for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many login attempts, please try again later.' });
  }
});

// Track login attempts
const loginAttempts = new Map();

// Clear login attempts every 15 minutes
setInterval(() => {
  loginAttempts.clear();
}, 15 * 60 * 1000);

// Import routes
const apiRoutes = require('./routes/index');
const chatRoutes = require('./routes/chat/chatRoutes');

// Mount API routes - all routes in apiRoutes will be prefixed with /api
// So routes defined as '/agents' in routes/index.js will be accessible as '/api/agents'
app.use('/api', apiRoutes);

// Mount chat routes separately for special handling
app.use('/api/chat', chatRoutes);

// Add diagnostic route for the recommendations API
app.get('/api-test/recommendations', (req, res) => {
  console.log('Recommendations API test hit!');
  return res.json({
    status: 'ok',
    message: 'Recommendations API test route is accessible',
    recommendations: [
      { id: 'test-1', title: 'Test Product 1', price: 9.99 },
      { id: 'test-2', title: 'Test Product 2', price: 0, isFree: true }
    ]
  });
});

// Add a specific route handler for wishlist API to help debug 404 errors
app.use('/api/wishlists*', (req, res, next) => {
  logger.warn(`Wishlist API 404: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Wishlist route not found. Please check the URL and method.',
    requestedPath: req.originalUrl,
    availableRoutes: [
      'GET /api/wishlists',
      'GET /api/wishlists/:id',
      'POST /api/wishlists',
      'PUT /api/wishlists/:id',
      'DELETE /api/wishlists/:id',
      'POST /api/wishlists/toggle'
    ]
  });
});

// Add root-level redirect for payment callbacks (placed before the catchall 404 handler)
app.get('/thankyou', (req, res) => {
  const { session_id } = req.query;
  // Get the frontend URL (default to localhost:5173 for development)
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  
  // Redirect to the new checkout success page with the session_id
  const redirectUrl = `${frontendUrl}/checkout/success?payment_id=${session_id}&status=success&type=checkout_session`;
  console.log(`Root redirect: Payment success to: ${redirectUrl}`);
  logger.info(`Root redirect: Payment success to: ${redirectUrl}`);
  
  return res.redirect(redirectUrl);
});

// Standard JSON parsing for all routes
app.use(express.json());

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  console.error(`API 404: ${req.method} ${req.originalUrl}`);
  
  // Get all registered routes on the app
  const routes = [];
  function print(path, layer) {
    if (layer.route) {
      layer.route.stack.forEach(print.bind(null, path));
    } else if (layer.name === 'router' && layer.handle.stack) {
      layer.handle.stack.forEach(print.bind(null, path));
    } else if (layer.method) {
      routes.push(`${layer.method.toUpperCase()} ${path}`);
    }
  }
  
  app._router.stack.forEach((layer) => {
    if (layer.route) {
      print(layer.route.path, layer);
    } else if (layer.name === 'router' && layer.handle.stack) {
      layer.handle.stack.forEach((stackItem) => {
        if (stackItem.route) {
          print(stackItem.route.path, stackItem);
        }
      });
    }
  });
  
  res.status(404).json({
    error: 'API route not found',
    message: 'The requested API endpoint does not exist or is not properly configured.',
    requestedPath: req.originalUrl,
    method: req.method,
    suggestedFixes: [
      'Check that the URL is correctly formatted',
      'Make sure the API route is registered in the routes/index.js file',
      'Verify that the API controller and route files exist',
      'Check if your backend server is running'
    ],
    availableEndpoints: [
      '/api/recommendations',
      '/api/recommendations/track-view',
      '/api/agents',
      '/api/payments',
      '/api/wishlists',
      '/api/ai-tools',
      '/api/prompts',
      '/api-test/recommendations'
    ]
  });
});

// Enhanced logging
app.use((req, res, next) => {
  let start = Date.now();
  res.on('finish', () => {
    let duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Catch-all 404 handler
app.use((req, res) => {
  // Log the 404 error with more details
  logger.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ error: 'Route not found.' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  // Log the error with more details
  logger.error(`Error processing ${req.method} ${req.originalUrl}: ${err.message}`);
  console.error(err.stack);
  
  // Send appropriate error response
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({ 
    error: err.message || 'Something went wrong!',
    path: req.originalUrl
  });
});

// Check if agents collection exists in development mode
if (!isProduction) {
  // Check if agents collection exists
  const checkAgentsCollection = async () => {
    try {
      console.log('Checking if agents collection exists...');
      const agentsSnapshot = await db.collection('agents').limit(1).get();
      if (agentsSnapshot.empty) {
        console.log('⚠️ Agents collection is empty or does not exist.');
        console.log('You may want to run: npm run check:agents');
        console.log('This will populate the database with mock agents for development.');
      } else {
        console.log('✅ Agents collection exists with data.');
      }
    } catch (error) {
      console.error('Error checking agents collection:', error);
    }
  };
  
  // NEW: Check if prompts collection exists and initialize cache
  const checkPromptsCollection = async () => {
    try {
      console.log('Checking if prompts collection exists...');
      const promptsSnapshot = await db.collection('prompts').limit(1).get();
      if (promptsSnapshot.empty) {
        console.log('⚠️ Prompts collection is empty or does not exist.');
        console.log('Prompts collection will be created when you add your first prompt via the API.');
      } else {
        console.log('✅ Prompts collection exists with data.');
      }
      
      // Initialize prompts cache
      console.log('🔄 Initializing prompts cache...');
      try {
        const { initializePromptsCache } = require('./routes/ai-tools/prompts');
        await initializePromptsCache();
        console.log('✅ Prompts cache initialized successfully.');
      } catch (cacheError) {
        console.error('❌ Failed to initialize prompts cache:', cacheError.message);
      }
      
    } catch (error) {
      console.error('Error checking prompts collection:', error);
    }
  };
  
  // Run the checks
  checkAgentsCollection();
  checkPromptsCollection();
}

// ------------------ Start the Server ------------------
const server = app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Firebase credentials available: ${!!process.env.FIREBASE_SERVICE_ACCOUNT_JSON}`);
  console.log(`CORS origins: ${allowedOrigins.join(', ')}`);
  console.log(`Storage bucket: ${process.env.FIREBASE_STORAGE_BUCKET}`);
  console.log(`Firestore database available: ${!!db}`);
  
  // Initialize prompts cache on production startup
  if (isProduction) {
    try {
      console.log('🔄 Initializing prompts cache on production startup...');
      const { initializePromptsCache } = require('./routes/ai-tools/prompts');
      await initializePromptsCache();
      console.log('✅ Prompts cache initialized successfully on production startup.');
    } catch (error) {
      console.error('❌ Failed to initialize prompts cache on production startup:', error);
    }
  }
});

// Add error handler for the server
server.on('error', (error) => {
  console.error('Server failed to start:', error);
});