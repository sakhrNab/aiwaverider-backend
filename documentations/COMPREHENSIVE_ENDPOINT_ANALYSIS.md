# Comprehensive Endpoint Analysis

## Overview
This document provides a complete analysis of all API endpoints in the AIWaverider backend, identifying which ones are documented in Swagger and which ones are missing.

## Summary Statistics
- **Total Route Files Analyzed**: 28
- **Endpoints Documented in Swagger**: ~120+
- **Endpoints Missing from Swagger**: ~50+
- **Coverage**: ~70%

## 🔍 **Endpoints Found in index.js (Not in Route Files)**

### Root Level Endpoints
- ❌ GET /_health - Basic health check (before middleware)
- ❌ GET /api-docs - Swagger UI interface
- ❌ GET /api-docs.json - Raw Swagger JSON specification
- ❌ GET /api-test/recommendations - Test recommendations API
- ❌ GET /thankyou - Payment success redirect callback

## ✅ **Endpoints Already Documented in Swagger**

### Authentication Routes (`/api/auth/`)
- ✅ POST /signup - User registration
- ✅ POST /session - Create session with Firebase token
- ✅ POST /create-session - Alias for session creation
- ✅ POST /signout - Sign out user
- ✅ POST /verify-user - Verify user token
- ✅ POST /refresh - Refresh token

### Agents Management (`/api/agents/`)
- ✅ GET / - Get all agents with pagination
- ✅ GET /featured - Get featured agents
- ✅ GET /latest - Get latest agents
- ✅ GET /count - Get agent count
- ✅ GET /search/count - Get search results count
- ✅ GET /:agentId - Get agent by ID

### User Management (`/api/users/`) - 5 endpoints
- ✅ GET / - Get all users with pagination
- ✅ GET /:userId - Get single user by ID
- ✅ POST / - Create new user
- ✅ PUT /:userId - Update user
- ✅ DELETE /:userId - Delete user

### Profile Management (`/api/profile/`) - 12 endpoints
- ✅ GET / - Get user profile
- ✅ PUT / - Update user profile
- ✅ PUT /upload-avatar - Upload avatar image
- ✅ PUT /interests - Update user interests
- ✅ GET /notifications - Get notification settings
- ✅ PUT /notifications - Update notification settings
- ✅ GET /subscriptions - Get user subscriptions
- ✅ GET /favorites - Get user favorites
- ✅ POST /favorites - Add to favorites
- ✅ DELETE /favorites/:id - Remove from favorites
- ✅ GET /settings - Get user settings
- ✅ PUT /settings - Update user settings
- ✅ GET /community - Get community links

### Posts Management (`/api/posts/`) - 16 endpoints
- ✅ GET /health - Health check
- ✅ GET / - Get all posts
- ✅ GET /multi-category - Get multi-category posts
- ✅ GET /batch-comments - Get batch comments
- ✅ POST /batch-comments - Get batch comments (POST)
- ✅ GET /:postId - Get post by ID
- ✅ GET /:postId/comments - Get post comments
- ✅ POST / - Create post (protected)
- ✅ PUT /:postId - Update post (protected)
- ✅ DELETE /:postId - Delete post (protected)
- ✅ POST /:postId/like - Toggle like (protected)
- ✅ POST /:postId/comments - Add comment (protected)
- ✅ PUT /:postId/comments/:commentId - Update comment (protected)
- ✅ DELETE /:postId/comments/:commentId - Delete comment (protected)
- ✅ POST /:postId/comments/:commentId/like - Like comment (protected)
- ✅ POST /:postId/comments/:commentId/unlike - Unlike comment (protected)
- ✅ POST /:postId/view - Track post view
- ✅ POST /initialize-views - Initialize view counts (admin)

### Individual Agent Management (`/api/agent/`) - 12 endpoints
- ✅ GET /test - Test route
- ✅ POST /with-price - Create agent with price
- ✅ POST /:id/combined-update - Combined update (POST)
- ✅ PUT /:id/combined-update - Combined update (PUT)
- ✅ POST / - Create agent
- ✅ GET /:id - Get agent by ID
- ✅ PUT /:id - Update agent
- ✅ PATCH /:id - Update agent
- ✅ DELETE /:id - Delete agent
- ✅ POST /:id - Update agent (POST)
- ✅ GET /:id/price - Get agent price
- ✅ POST /:id/price - Update agent price
- ✅ PUT /:id/price - Update agent price

### Wishlists Management (`/api/wishlists/`) - 7 endpoints
- ✅ GET / - Get all public wishlists
- ✅ GET /user - Get user's wishlists
- ✅ GET /:wishlistId - Get wishlist by ID
- ✅ POST / - Create wishlist
- ✅ PUT /:wishlistId - Update wishlist
- ✅ DELETE /:wishlistId - Delete wishlist
- ✅ POST /toggle - Toggle agent in wishlist

### Agent Prices (`/api/agent-prices/`) - 9 endpoints
- ✅ GET /:id - Get price by ID
- ✅ GET /:id/history - Get price history
- ✅ POST /:id - Update price
- ✅ PATCH /:id/discount - Apply discount
- ✅ GET /agent/:agentId/price - Get agent price
- ✅ POST /agent/:agentId/price - Update agent price
- ✅ GET /history - Get all price history
- ✅ GET /:agentId/history - Get agent price history
- ✅ POST /migrate - Migrate price data

### Other Documented Endpoints
- ✅ GET /api/ai-tools - Get all AI tools
- ✅ GET /api/payments/test - Test payment system
- ✅ GET /api/admin/settings - Get site settings
- ✅ GET /api/health - Health check endpoint
- ✅ GET /api/videos - List videos with pagination
- ✅ POST /api/chat - Process chat message

## ❌ **Endpoints Missing from Swagger**

### 1. Recommendations (`/api/recommendations/`) - 5 endpoints
- ❌ GET /test - Test recommendations
- ❌ GET /diagnostic - Diagnostic endpoint
- ❌ GET / - Get personalized recommendations
- ❌ POST /track-view - Track product view
- ❌ GET /real-agents - Get real agents only

### 2. Prompts Management (`/api/prompts/`) - 12 endpoints
- ❌ GET / - Get all prompts with search/filtering
- ❌ GET /count - Get total count of prompts
- ❌ GET /categories - Get prompt categories with counts
- ❌ GET /featured - Get featured prompts
- ❌ GET /user/:userId/liked - Get user's liked prompts
- ❌ POST /cache/refresh - Manual cache refresh (admin)
- ❌ GET /:id - Get single prompt by ID
- ❌ POST / - Create new prompt (admin)
- ❌ PUT /:id - Update prompt (admin)
- ❌ DELETE /:id - Delete prompt (admin)
- ❌ POST /:id/like - Toggle like on prompt
- ❌ GET /user/:userId/liked - Get user's liked prompts (duplicate)

### 3. PayPal Integration (`/api/payments/paypal/`) - 12 endpoints
- ❌ POST /create-order - Create PayPal order
- ❌ POST /capture - Capture PayPal payment
- ❌ POST /subscriptions/confirm - Confirm subscription
- ❌ POST /subscriptions/test-create - Test create subscription
- ❌ GET /subscriptions/test-create - Test create subscription (GET)
- ❌ GET /subscriptions/:id - Get subscription status
- ❌ POST /webhook - PayPal webhook handler
- ❌ GET /plans - List PayPal plans
- ❌ GET /plans/:id - Get plan details
- ❌ GET /config - Get PayPal config

### 4. UniPay Integration (`/api/chat/unipay/`) - 15 endpoints
- ❌ GET /health - Health check
- ❌ GET /methods/:orderHashId - Get payment methods
- ❌ POST /process-redirect - Process payment redirect
- ❌ POST /confirm-order - Confirm order
- ❌ GET /status/:orderHashId - Get payment status
- ❌ POST /refund - Create refund
- ❌ POST /webhook - Webhook handler
- ❌ GET /success - Success callback
- ❌ GET /cancel - Cancel callback
- ❌ GET /errors - Get error list
- ❌ GET /statuses - Get status list
- ❌ POST /paypal/create-order - Create PayPal order
- ❌ POST /paypal/capture - Capture PayPal payment

### 5. Admin Email (`/api/admin/email/`) - 2 endpoints
- ❌ POST /welcome/:userId - Send welcome email
- ❌ POST /announcement - Send global announcement

### 6. Email Management (`/api/email/`) - 18 endpoints
- ❌ POST /test - Send test email
- ❌ POST /welcome - Send welcome email
- ❌ POST /update - Send update email
- ❌ POST /global - Send global announcement
- ❌ POST /send-custom - Send custom email
- ❌ POST /send-agent-update - Send agent update email
- ❌ POST /send-tool-update - Send tool update email
- ❌ PUT /preferences/:userId - Update email preferences
- ❌ POST /update/users - Send update to specific users
- ❌ GET /templates/:templateType - Get email template
- ❌ POST /templates/:templateType - Update email template
- ❌ POST /test-welcome - Send test welcome email
- ❌ POST /test-update - Send test update email
- ❌ POST /test-global - Send test global email
- ❌ POST /test-agent - Send test agent email
- ❌ POST /test-tool - Send test tool email
- ❌ POST /test-custom - Send test custom email
- ❌ POST /test-agent-update - Send test agent update email

### 7. Cache Management (`/api/cache/`) - 5 endpoints
- ❌ POST /refresh - Refresh all caches
- ❌ POST /refresh/ai-tools - Refresh AI tools cache
- ❌ POST /refresh/prompts - Refresh prompts cache
- ❌ DELETE /clear - Clear all caches
- ❌ GET /status - Get cache status

### 8. Invoice Management (`/api/invoices/`) - 11 endpoints
- ❌ GET /:invoiceId - Get invoice by ID
- ❌ GET /number/:invoiceNumber - Get invoice by number
- ❌ GET /customer/:customerId - Get customer invoices
- ❌ GET /order/:orderId - Get invoices by order ID
- ❌ POST /search - Search invoices
- ❌ POST /create - Create manual invoice
- ❌ PUT /:invoiceId/status - Update invoice status
- ❌ GET /:invoiceId/pdf - Generate invoice PDF
- ❌ GET /stats/:period - Get invoice statistics
- ❌ POST /export - Export invoices to CSV
- ❌ DELETE /:invoiceId - Delete invoice (admin)

### 9. Template Management (`/api/templates/`) - 7 endpoints
- ❌ GET /download/:agentId - Download agent template
- ❌ GET /access/:token - Get template access info
- ❌ GET /order/:orderId - List templates for order
- ❌ POST /revoke/:token - Revoke template access
- ❌ POST /access - Create template access token
- ❌ GET /stats - Get template download statistics

### 10. Token Generation (`/api/tokens/`) - 5 endpoints
- ❌ GET /admin - Generate admin token
- ❌ GET /user - Generate user token
- ❌ GET /both - Generate both tokens
- ❌ POST /custom - Generate custom token
- ❌ GET /health - Health check

### 15. Test Authentication (`/api/test-auth/`) - 4 endpoints
- ❌ POST /clear-cache - Clear cache (admin)
- ❌ POST /agents - Create agent (admin)
- ❌ GET /agents - Get agents
- ❌ GET /health - Health check

### 16. Simple Tokens (`/api/simple-tokens/`) - 3 endpoints
- ❌ GET /admin - Generate admin token
- ❌ GET /user - Generate user token
- ❌ GET /health - Health check

### 17. Test Routes (`/api/test/`) - 2 endpoints
- ❌ GET /agent-price-test - Test route
- ❌ POST /create-agent-price - Test create agent price

## Priority for Missing Endpoints

### High Priority
1. Posts management (`/api/posts/`)
2. Individual agent management (`/api/agent/`)
3. Wishlists management (`/api/wishlists/`)
4. Agent prices (`/api/agent-prices/`)

### Medium Priority
1. Payment integrations (PayPal, UniPay)
2. Admin functions
3. Cache management
4. Invoice management
5. Template management

### Low Priority
1. Test routes
2. Token generation
3. Debug endpoints

## Next Steps
1. Add missing high-priority endpoints to Swagger documentation
2. Complete user and profile management documentation
3. Add posts and content management endpoints
4. Document payment and admin functionality
5. Add comprehensive request/response schemas
6. Test all documented endpoints
