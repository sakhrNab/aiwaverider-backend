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
const paymentsRoutes = require('./payments/payments');
const recommendationsRoutes = require('./agents/recommendations');
const aiToolsRoutes = require('./ai-tools/ai-tools');
const adminRoutes = require('./admin/admin');
const adminEmailRoutes = require('./admin/adminEmailRoutes');
const emailRoutes = require('./api/emailRoutes');
const healthRoutes = require('./health');
const videosRoutes = require('./videos/videos');

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
router.use('/payments', paymentsRoutes);
router.use('/recommendations', recommendationsRoutes);
router.use('/ai-tools', aiToolsRoutes);
router.use('/admin', adminRoutes);
router.use('/admin/email', adminEmailRoutes);
// Note: /api/chat is mounted separately in the main app file
router.use('/email', emailRoutes);
router.use('/health', healthRoutes);

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