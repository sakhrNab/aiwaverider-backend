// backend/routes/index.js
const express = require('express');
const router = express.Router();

// Import all API routes
const authRoutes = require('./api/authRoutes');
const usersRoutes = require('./api/users');
const postsRoutes = require('./posts/posts');
const profileRoutes = require('./users/profile');
const agentsRoutes = require('./agents/agents');
const agentRoutes = require('./agents/agent'); 
const wishlistsRoutes = require('./agents/wishlists');
const pricesRoutes = require('./agents/prices');
const testRoutes = require('./test');

// Updated payment system routes
const paymentsRoutes = require('./payments/payments'); // Your updated main payment routes
const invoiceRoutes = require('./invoice/invoiceRoutes'); // New invoice management
const templateRoutes = require('./template/templateRoutes'); // New template downloads

const recommendationsRoutes = require('./agents/recommendations');
const aiToolsRoutes = require('./ai-tools/ai-tools');

// NEW: Import prompts routes - destructure the router from the exported object
const { router: promptsRoutes } = require('./ai-tools/prompts');

// NEW: Import cache management routes
const cacheRoutes = require('./api/cacheRoutes');

const adminRoutes = require('./admin/admin');
const adminEmailRoutes = require('./admin/adminEmailRoutes');
const emailRoutes = require('./api/emailRoutes');
const healthRoutes = require('./health');
const videosRoutes = require('./videos/videos');
const tokenRoutes = require('./api/tokenRoutes');
const testAuthRoutes = require('./api/testAuthRoutes');
const simpleTokenRoutes = require('./api/simpleTokenRoutes');

// Mount routes - these will all be under /api in the main app
// IMPORTANT: Mount specific routes before catch-all routes
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/posts', postsRoutes);
router.use('/profile', profileRoutes);
router.use('/videos', videosRoutes); // Move videos before agents to prevent catch-all interference
router.use('/agents', agentsRoutes);
router.use('/agent', agentRoutes);
router.use('/wishlists', wishlistsRoutes);
router.use('/agent-prices', pricesRoutes);
router.use('/test', testRoutes);

// Payment system routes (updated)
router.use('/payments', paymentsRoutes);    // Main payment endpoints + UniPay subroutes
router.use('/invoices', invoiceRoutes);     // Invoice management API
router.use('/templates', templateRoutes);   // Secure template downloads

router.use('/recommendations', recommendationsRoutes);
router.use('/ai-tools', aiToolsRoutes);

// NEW: Mount prompts routes - completely separate from ai-tools
router.use('/prompts', promptsRoutes);

// NEW: Mount cache management routes
router.use('/cache', cacheRoutes);

router.use('/admin', adminRoutes);
router.use('/admin/email', adminEmailRoutes);
// Note: /api/chat is mounted separately in the main app file
router.use('/email', emailRoutes);
router.use('/health', healthRoutes);
router.use('/tokens', tokenRoutes);
router.use('/test-auth', testAuthRoutes);
router.use('/simple-tokens', simpleTokenRoutes);

// Add redirect for product routes to the agents routes
// This handles legacy or alternative product URLs
router.get('/product/:productId', (req, res) => {
  console.log(`Redirecting /product/${req.params.productId} to /agents/${req.params.productId}`);
  res.redirect(`/agents/${req.params.productId}`);
});

// Add API endpoint for product/:id that forwards to agents/:id
router.get('/product/:productId', (req, res) => {
  const productId = req.params.productId;
  console.log(`Forwarding API request from /product/${productId} to /agents/${productId}`);
  
  // Forward the request to the agents API endpoint
  req.url = `/agents/${productId}`;
  router.handle(req, res);
});

module.exports = router;