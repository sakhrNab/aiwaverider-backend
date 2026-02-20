// backend/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const passport = require('passport');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const logger = require('./utils/logger');
const { initializePassport } = require('./config/passport');
const { pool } = require('./config/database');
const { initializeSettings, getRateLimits, defaultSettings } = require('./models/siteSettings');
const uploadMiddleware = require('./middleware/upload');
const cron = require('node-cron');
const { syncAllChannels } = require('./services/videoSync');

// Swagger configuration
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

// Initialize express
const app = express();

// Trust proxy (behind Traefik/Coolify reverse proxy)
app.set('trust proxy', 1);

// Basic health check route - must be before ANY middleware
app.get('/_health', (_, res) => res.send('OK'));

// Environment variables
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';
const PORT = process.env.PORT || (isProduction ? 8080 : 4000);

// Initialize site settings
initializeSettings().catch(err => {
  logger.error('Failed to initialize site settings:', err);
});

// Make upload middleware available globally
app.locals.upload = uploadMiddleware;

// Serve static files from uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ------------------ Swagger Documentation ------------------
// Serve Swagger UI in both development and production
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'AIWaverider API Documentation',
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    showExtensions: true,
    showCommonExtensions: true,
    // Enable CORS for Swagger UI
    requestInterceptor: (req) => {
      req.headers['Access-Control-Allow-Origin'] = '*';
      req.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
      req.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With';
      return req;
    }
  }
}));

// Serve raw Swagger JSON
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.send(swaggerSpec);
});

// ------------------ CORS Configuration ------------------
const allowedOrigins = isProduction
  ? (process.env.CORS_ORIGINS || '').split(',').map(origin => origin.trim())
  : ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:45977', 'http://localhost:4000', 'http://127.0.0.1:4000']; // Frontend origins + backend self-requests

// Create a CORS middleware function with proper configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl requests, or same origin)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else if (isDevelopment && origin && origin.includes('localhost')) {
      // In development, allow any localhost origin
      callback(null, true);
    } else {
      logger.warn(`CORS blocked request from origin: ${origin}`);
      callback(new Error(`CORS policy: Origin ${origin} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Cache-Control', 'Pragma', 'X-Admin-Token', 'x-admin-token'],
  credentials: true,
  maxAge: 86400 // 24 hours
};

// Log active CORS configuration
logger.info(`CORS configured with allowed origins: ${JSON.stringify(allowedOrigins)}`);
logger.info(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);

// Apply middleware
app.use(cors(corsOptions));
// Ensure preflight requests are handled
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Add security headers
app.use(helmet());

// Session configuration - required for Passport
const { redis: redisClient } = require('./utils/cache');
app.use(session({
  store: new RedisStore({ client: redisClient, prefix: 'sess:' }),
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

// ------------------ Rate Limiting (admin-configurable) ------------------
const limiter = rateLimit({
  windowMs: defaultSettings.rateLimits.globalApi.windowMinutes * 60 * 1000,
  max: async () => {
    try {
      const limits = await getRateLimits();
      return limits.globalApi?.maxRequests || defaultSettings.rateLimits.globalApi.maxRequests;
    } catch {
      return defaultSettings.rateLimits.globalApi.maxRequests;
    }
  },
  message: 'Too many requests, please try again later.',
});

// Apply rate limiting only in production or development
if (isProduction || isDevelopment) {
  app.use(limiter);
}

// Rate limiting for auth routes (admin-configurable)
const authLimiter = rateLimit({
  windowMs: defaultSettings.rateLimits.authRoutes.windowMinutes * 60 * 1000,
  max: async () => {
    try {
      const limits = await getRateLimits();
      return limits.authRoutes?.maxRequests || defaultSettings.rateLimits.authRoutes.maxRequests;
    } catch {
      return defaultSettings.rateLimits.authRoutes.maxRequests;
    }
  },
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many login attempts, please try again later.' });
  }
});

// Track login attempts (with size limit to prevent memory leaks)
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS_ENTRIES = 10000;

// Clear login attempts every 15 minutes
setInterval(() => {
  loginAttempts.clear();
}, 15 * 60 * 1000);

// Safety valve: if the map grows too large between clears, prune oldest entries
const trackLoginAttempt = (key, value) => {
  if (loginAttempts.size >= MAX_LOGIN_ATTEMPTS_ENTRIES) {
    // Delete the first (oldest) 20% of entries
    const deleteCount = Math.floor(MAX_LOGIN_ATTEMPTS_ENTRIES * 0.2);
    const iterator = loginAttempts.keys();
    for (let i = 0; i < deleteCount; i++) {
      loginAttempts.delete(iterator.next().value);
    }
  }
  loginAttempts.set(key, value);
};

// Import routes
const apiRoutes = require('./routes/index');
const chatRoutes = require('./routes/chat/chatRoutes');

// Mount auth rate limiter on auth routes before they're handled
app.use('/api/auth', authLimiter);

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

// Check if tables have data in development mode
if (!isProduction) {
  const checkTables = async () => {
    try {
      console.log('Checking PostgreSQL tables...');
      const { rows: agentRows } = await pool.query('SELECT COUNT(*) as count FROM agents');
      const agentCount = parseInt(agentRows[0].count);
      if (agentCount === 0) {
        console.log('⚠️ Agents table is empty.');
        console.log('You may want to run the seed script to populate the database.');
      } else {
        console.log(`✅ Agents table has ${agentCount} records.`);
      }

      const { rows: promptRows } = await pool.query('SELECT COUNT(*) as count FROM prompts');
      const promptCount = parseInt(promptRows[0].count);
      if (promptCount === 0) {
        console.log('⚠️ Prompts table is empty.');
      } else {
        console.log(`✅ Prompts table has ${promptCount} records.`);
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
      console.error('Error checking PostgreSQL tables:', error.message);
    }
  };

  checkTables();
}

// ------------------ Start the Server ------------------
const server = app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Firebase credentials available: ${!!process.env.FIREBASE_SERVICE_ACCOUNT_JSON}`);
  console.log(`CORS origins: ${allowedOrigins.join(', ')}`);
  console.log(`Storage bucket: ${process.env.FIREBASE_STORAGE_BUCKET}`);
  console.log(`PostgreSQL database: ${process.env.PGDATABASE || 'aiwaverider'}@${process.env.PGHOST || 'localhost'}:${process.env.PGPORT || '5432'}`);
  
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

  // Auto-migrate: create apps table if it doesn't exist
  try {
    const { rows } = await pool.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'apps')"
    );
    if (!rows[0].exists) {
      console.log('🔄 Apps table not found — running migration...');
      const fs = require('fs');
      const path = require('path');
      const migrationPath = path.join(__dirname, 'migration', '004_apps.sql');
      if (fs.existsSync(migrationPath)) {
        const sql = fs.readFileSync(migrationPath, 'utf8');
        await pool.query(sql);
        console.log('✅ Apps table created and seeded successfully');
      } else {
        // Inline fallback if migration file not found
        await pool.query(`
          CREATE TABLE IF NOT EXISTS apps (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, type TEXT DEFAULT 'app',
            category TEXT, categories TEXT[] DEFAULT '{}', description TEXT,
            short_description TEXT, version TEXT DEFAULT '1.0.0',
            price NUMERIC(10,2) DEFAULT 0, is_free BOOLEAN DEFAULT TRUE,
            price_details JSONB DEFAULT '{}', image_url TEXT, image_filename TEXT,
            icon_url TEXT, icon_filename TEXT, external_url TEXT, download_url TEXT,
            download_filename TEXT, video_url TEXT, screenshots JSONB DEFAULT '[]',
            features TEXT[] DEFAULT '{}', tags TEXT[] DEFAULT '{}',
            platform_support TEXT[] DEFAULT '{}', system_requirements TEXT,
            resources JSONB DEFAULT '[]', related_apps JSONB DEFAULT '[]',
            is_featured BOOLEAN DEFAULT FALSE, is_published BOOLEAN DEFAULT TRUE,
            download_count INTEGER DEFAULT 0, view_count INTEGER DEFAULT 0,
            likes TEXT[] DEFAULT '{}', rating_average NUMERIC(3,2) DEFAULT 0,
            rating_count INTEGER DEFAULT 0, created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE OR REPLACE TRIGGER trg_apps_updated_at BEFORE UPDATE ON apps FOR EACH ROW EXECUTE FUNCTION update_updated_at();
        `);
        // Seed 6 production apps
        await pool.query(`
          INSERT INTO apps (id, title, type, category, categories, description, short_description, features, tags, platform_support, is_featured, is_published) VALUES
          ('app-ai-wavecut', 'AI WaveCut', 'app', 'Video Editing', '{"Video Editing","AI","Productivity"}', 'AI-powered video editor with intelligent scene detection, auto-captioning, and smart trimming.', 'AI-powered video editor with smart scene detection and auto-captioning.', '{"AI scene detection","Auto-captioning","Smart trimming","Batch export","Timeline editing","Multi-format support"}', '{"video","editor","AI","captions","vibe coding"}', '{"Windows","Mac","Linux","Web"}', TRUE, TRUE),
          ('app-flowstate', 'FlowState', 'app', 'Productivity', '{"Productivity","AI","Focus"}', 'AI-driven productivity app combining Pomodoro timing, focus music, and task prioritization.', 'AI productivity app combining focus timing, task management, and distraction blocking.', '{"Pomodoro timer","AI task prioritization","Focus music","Distraction blocking","Daily analytics"}', '{"productivity","focus","pomodoro","AI","vibe coding"}', '{"Windows","Mac","Linux","Web"}', TRUE, TRUE),
          ('app-srt-translator-pro', 'SRT Translator Pro', 'app', 'Translation', '{"Translation","AI","Subtitles"}', 'Professional subtitle translator supporting 50+ languages with context-aware AI translation.', 'AI subtitle translator for 50+ languages with context-aware translation.', '{"50+ languages","Context-aware translation","SRT/VTT/ASS export","Batch processing","Timing preservation"}', '{"subtitles","translation","SRT","AI","vibe coding"}', '{"Windows","Mac","Linux","Web"}', TRUE, TRUE),
          ('app-ai-job-writer', 'AI Job Writer', 'app', 'Career', '{"Career","AI","Resume"}', 'AI resume and cover letter generator with ATS optimization and interview prep.', 'AI-powered resume and cover letter generator with ATS optimization.', '{"Job description analysis","ATS optimization","Cover letter generation","Interview prep","Keyword matching"}', '{"resume","cover letter","job","career","AI","vibe coding"}', '{"Web"}', TRUE, TRUE),
          ('app-outbound-ai', 'Outbound AI', 'app', 'Sales', '{"Sales","AI","Outreach"}', 'AI cold outreach platform with prospect research and multi-channel follow-up sequences.', 'AI cold outreach tool with prospect research and multi-channel follow-ups.', '{"Prospect research","Personalized messaging","Multi-channel outreach","Follow-up sequences","Analytics dashboard"}', '{"sales","outreach","cold email","AI","automation","vibe coding"}', '{"Web"}', TRUE, TRUE),
          ('app-email-ai', 'Email AI', 'app', 'Automation', '{"Automation","AI","Email"}', 'Intelligent email automation for categorization, smart replies, and follow-up management.', 'AI email automation for categorization, smart replies, and follow-up management.', '{"Email categorization","AI draft replies","Smart follow-ups","Gmail integration","Outlook integration"}', '{"email","automation","AI","Gmail","Outlook","vibe coding"}', '{"Web"}', TRUE, TRUE)
          ON CONFLICT (id) DO NOTHING;
        `);
        console.log('✅ Apps table created and seeded (inline fallback)');
      }
    }
  } catch (err) {
    console.warn('⚠️ Apps table migration check failed:', err.message);
  }

  // Auto-migrate: create skool_downloads table if it doesn't exist
  try {
    const { rows: sdRows } = await pool.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'skool_downloads')"
    );
    if (!sdRows[0].exists) {
      console.log('🔄 skool_downloads table not found — running migration...');
      const fs = require('fs');
      const path = require('path');
      const migrationPath = path.join(__dirname, 'migration', '005_skool_downloads.sql');
      if (fs.existsSync(migrationPath)) {
        const sql = fs.readFileSync(migrationPath, 'utf8');
        await pool.query(sql);
        console.log('✅ skool_downloads table created successfully');
      } else {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS skool_downloads (
            id TEXT PRIMARY KEY, app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
            email TEXT NOT NULL, download_count INTEGER DEFAULT 1,
            created_at TIMESTAMPTZ DEFAULT NOW(), last_downloaded_at TIMESTAMPTZ,
            UNIQUE(app_id, email)
          );
          CREATE INDEX IF NOT EXISTS idx_skool_downloads_app_id ON skool_downloads (app_id);
          CREATE INDEX IF NOT EXISTS idx_skool_downloads_email ON skool_downloads (email);
        `);
        console.log('✅ skool_downloads table created (inline fallback)');
      }
    }
  } catch (err) {
    console.warn('⚠️ skool_downloads migration check failed:', err.message);
  }

  // Auto-migrate: create email_templates table if it doesn't exist
  try {
    const { rows: etRows } = await pool.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'email_templates')"
    );
    if (!etRows[0].exists) {
      console.log('🔄 email_templates table not found — running migration...');
      const fs = require('fs');
      const path = require('path');
      const migrationPath = path.join(__dirname, 'migration', '006_email_templates.sql');
      if (fs.existsSync(migrationPath)) {
        const sql = fs.readFileSync(migrationPath, 'utf8');
        await pool.query(sql);
        console.log('✅ email_templates table created successfully');
      } else {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS email_templates (
            type TEXT PRIMARY KEY, subject TEXT NOT NULL,
            content TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ DEFAULT NOW()
          );
        `);
        console.log('✅ email_templates table created (inline fallback)');
      }
    }
  } catch (err) {
    console.warn('⚠️ email_templates migration check failed:', err.message);
  }

  // Auto-migrate: create notifications table if it doesn't exist
  try {
    const { rows: ntRows } = await pool.query(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'notifications')"
    );
    if (!ntRows[0].exists) {
      console.log('🔄 notifications table not found — running migration...');
      const fs = require('fs');
      const path = require('path');
      const migrationPath = path.join(__dirname, 'migration', '007_notifications.sql');
      if (fs.existsSync(migrationPath)) {
        const sql = fs.readFileSync(migrationPath, 'utf8');
        await pool.query(sql);
        console.log('✅ notifications table created successfully');
      } else {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type TEXT NOT NULL DEFAULT 'general',
            title TEXT NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            read BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW()
          );
          CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
          CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, read);
        `);
        console.log('✅ notifications table created (inline fallback)');
      }
    }
  } catch (err) {
    console.warn('⚠️ notifications migration check failed:', err.message);
  }

  // Initialize Qdrant collections + auto-index on first run (RAG)
  try {
    console.log('🔄 Initializing Qdrant collections...');
    const { initCollections, indexAll } = require('./services/rag/qdrantService');
    await initCollections();
    console.log('✅ Qdrant collections initialized');

    // Auto-index content into Qdrant if collections are empty (first deploy)
    try {
      const { QdrantClient } = require('@qdrant/js-client-rest');
      const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
      const client = new QdrantClient({ url: qdrantUrl });
      const agentsInfo = await client.getCollection('agents');
      if (agentsInfo.points_count === 0) {
        console.log('🔄 Qdrant collections are empty — running initial indexing...');
        const counts = await indexAll();
        console.log(`✅ Qdrant initial indexing complete: ${JSON.stringify(counts)}`);
      } else {
        console.log(`✅ Qdrant already has data (${agentsInfo.points_count} agent points) — skipping bulk index`);
      }
    } catch (indexErr) {
      console.warn('⚠️ Qdrant auto-indexing skipped:', indexErr.message);
    }
  } catch (error) {
    console.warn('⚠️ Qdrant initialization skipped (service may not be running):', error.message);
  }

  // Initialize video channel sync
  try {
    console.log('🔄 Setting up video channel sync...');
    
    // Don't run sync on startup - let cron jobs handle it
    // YouTube: Daily at midnight (00:00)
    // TikTok: Monthly on the 1st at 00:00

    // Schedule sync jobs
    // YouTube: Daily at midnight (00:00)
    // TikTok: Monthly on the 1st at 00:00
    cron.schedule('0 0 * * *', async () => {
      console.log('🔄 Starting scheduled daily video channel sync (YouTube)...');
      try {
        const { syncYouTubeChannel } = require('./services/videoSync');
        const youtubeResults = await syncYouTubeChannel();
        console.log('✅ YouTube sync completed:', {
          videosAdded: youtubeResults.videosAdded,
          videosUpdated: youtubeResults.videosUpdated,
          errors: youtubeResults.errors.length
        });
      } catch (error) {
        console.error('❌ YouTube sync failed:', error);
        logger.error('YouTube sync failed', { error: error.message });
      }
    });
    
    // TikTok: Monthly sync on the 1st of each month at 00:00
    // Cron format: '0 0 1 * *' = At 00:00 on the 1st day of every month
    cron.schedule('0 0 1 * *', async () => {
      console.log('🔄 Starting scheduled monthly TikTok video sync...');
      try {
        const { syncTikTokUser } = require('./services/videoSync');
        const tiktokResults = await syncTikTokUser();
        console.log('✅ TikTok sync completed:', {
          videosAdded: tiktokResults.videosAdded,
          videosUpdated: tiktokResults.videosUpdated,
          errors: tiktokResults.errors.length
        });
      } catch (error) {
        console.error('❌ TikTok sync failed:', error);
        logger.error('TikTok sync failed', { error: error.message });
      }
    });
    
    console.log('✅ Video channel sync scheduled:');
    console.log('   - YouTube: Daily at 00:00 (midnight)');
    console.log('   - TikTok: Monthly on the 1st at 00:00');
  } catch (error) {
    console.error('❌ Failed to set up video channel sync:', error);
    logger.error('Failed to set up video channel sync', { error: error.message });
  }
});

// Add error handler for the server
server.on('error', (error) => {
  console.error('Server failed to start:', error);
});