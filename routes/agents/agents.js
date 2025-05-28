// backend/routes/agents.js
const express = require('express');
const router = express.Router();
const agentsController = require('../../controllers/agent/agentsController');
const { validateFirebaseToken, isAdmin } = require('../../middleware/authenticationMiddleware');
const publicCacheMiddleware = require('../../middleware/publicCacheMiddleware');
const upload = require('../../middleware/upload');
const { db } = require('../../config/firebase');
const admin = require('firebase-admin');
const { auth } = require('../../middleware/authenticationMiddleware');

// Helper function to increment agent download count
async function incrementAgentDownloadCount(agentId) {
  try {
    const agentRef = db.collection('agents').doc(agentId);
    await agentRef.update({
      downloadCount: admin.firestore.FieldValue.increment(1)
    });
    return true;
  } catch (error) {
    console.error(`Error incrementing download count for agent ${agentId}:`, error);
    return false;
  }
}

// Cache durations based on environment
const getDefaultCacheDuration = () => {
  return process.env.NODE_ENV === 'development' ? 30 : 300; // 30 seconds in dev, 5 minutes in production
};

const getFeaturedCacheDuration = () => {
  return process.env.NODE_ENV === 'development' ? 60 : 900; // 1 minute in dev, 15 minutes in production
};

// Public endpoints (cached)
router.get('/', publicCacheMiddleware({ duration: getDefaultCacheDuration() }), agentsController.getAgents);
router.get('/featured', publicCacheMiddleware({ duration: getFeaturedCacheDuration() }), agentsController.getFeaturedAgents);
router.get('/latest', publicCacheMiddleware({ duration: getDefaultCacheDuration() }), agentsController.getLatestAgentsRoute);

// Cache busting route
router.get('/refresh-cache', validateFirebaseToken, (req, res) => {
  // Clear the cache for the agents routes
  if (req.app.locals.cache) {
    const cacheKeys = Array.from(req.app.locals.cache.keys());
    const agentCacheKeys = cacheKeys.filter(key => key.includes('/api/agents'));
    
    agentCacheKeys.forEach(key => {
      req.app.locals.cache.del(key);
    });
    
    console.log(`Cleared ${agentCacheKeys.length} agent cache entries`);
    return res.status(200).json({ message: `Cleared ${agentCacheKeys.length} agent cache entries` });
  }
  
  return res.status(200).json({ message: 'No cache to clear' });
});

// Add a specific route for Firebase document IDs
router.get('/doc/:docId', publicCacheMiddleware({ duration: getDefaultCacheDuration() }), (req, res) => {
  // Set the agentId parameter to the docId and forward to the getAgentById controller
  req.params.id = req.params.docId;
  return agentsController.getAgentById(req, res);
});

// Add a specific route for the 'agent-XX' format IDs
router.get('/agent-:numericId([0-9]+)', publicCacheMiddleware({ duration: getDefaultCacheDuration() }), (req, res) => {
  // Set the agentId parameter and forward to the getAgentById controller
  // This captures 'agent-41' format directly using route parameter
  const agentId = `agent-${req.params.numericId}`;
  console.log(`Special route captured agent-XX format: ${agentId}`);
  req.params.id = agentId;
  return agentsController.getAgentById(req, res);
});

router.get('/:agentId', publicCacheMiddleware({ duration: getDefaultCacheDuration() }), agentsController.getAgentById);

// GET /api/agents/:agentId/downloads - Get download count for an agent
router.get('/:agentId/downloads', agentsController.getDownloadCount);

// POST /api/agents/:agentId/downloads - Increment download count
router.post('/:agentId/downloads', validateFirebaseToken, agentsController.incrementDownloadCount);

// ----- AGENT REVIEWS AND RATINGS -----

// Get reviews for an agent
// router.get('/:agentId/reviews', async (req, res) => {
//   try {
//     const { agentId } = req.params;
    
//     const reviewsQuery = db.collection('agent_reviews')
//       .where('agentId', '==', agentId)
//       .orderBy('createdAt', 'desc');
      
//     const reviewsSnapshot = await reviewsQuery.get();
//     const reviews = [];
    
//     reviewsSnapshot.forEach(doc => {
//       reviews.push({
//         id: doc.id,
//         ...doc.data()
//       });
//     });
    
//     res.json(reviews);
//   } catch (error) {
//     console.error('Error fetching agent reviews:', error);
//     res.status(500).json({ error: 'Failed to fetch reviews' });
//   }
// });

// Delete a review (admin only)
router.delete('/:agentId/reviews/:reviewId', validateFirebaseToken, 
  // isAdmin,
  agentsController.deleteAgentReview_controller
);
  
  // , async (req, res) => {
//   try {
//     const { agentId, reviewId } = req.params;
    
//     // Validate input
//     if (!reviewId || !reviewId.trim()) {
//       return res.status(400).json({ error: 'Review ID is required' });
//     }
    
//     // Get the agent document
//     const agentRef = db.collection('agents').doc(agentId);
//     const agentDoc = await agentRef.get();
    
//     if (!agentDoc.exists) {
//       return res.status(404).json({ error: 'Agent not found' });
//     }
    
//     const agentData = agentDoc.data();
//     const reviews = agentData.reviews || [];
    
//     // Find the review in the array
//     const reviewIndex = reviews.findIndex(review => review.id === reviewId);
    
//     if (reviewIndex === -1) {
//       return res.status(404).json({ error: 'Review not found in this agent\'s reviews' });
//     }
    
//     // Remove the review from the array
//     const removedReview = reviews.splice(reviewIndex, 1)[0];
    
//     // Recalculate average rating
//     let totalRating = 0;
//     const reviewCount = reviews.length;
    
//     reviews.forEach(review => {
//       totalRating += review.rating || 0;
//     });
    
//     const newAverageRating = reviewCount > 0 ? totalRating / reviewCount : 0;
    
//     // Update the agent document
//     await agentRef.update({
//       reviews: reviews,
//       rating: {
//         average: newAverageRating,
//         count: reviewCount
//       }
//     });
    
//     console.log(`Admin deleted review ${reviewId} from agent ${agentId}`);
//     console.log(`New rating: ${newAverageRating} from ${reviewCount} reviews`);
    
//     // Clear related Redis cache
//     try {
//       const { deleteCache } = require('../../utils/cache');
//       // Clear both with_reviews and no_reviews cache versions
//       await deleteCache(`agent:${agentId}:with_reviews`);
//       await deleteCache(`agent:${agentId}:no_reviews`);
//       console.log(`Cleared Redis cache for agent ${agentId} after review deletion`);
//     } catch (cacheError) {
//       console.error(`Error clearing cache for agent ${agentId}:`, cacheError);
//       // Continue execution as this is not critical
//     }
    
//     return res.status(200).json({ 
//       success: true,
//       message: 'Review deleted successfully',
//       reviewId: reviewId
//     });
//   } catch (error) {
//     console.error('Error deleting review:', error);
//     return res.status(500).json({ error: 'Failed to delete review' });
//   }
// });

// Add a review to an agent
router.post('/:agentId/reviews', validateFirebaseToken,
  agentsController.addAgentReview_controller
);
//   async (req, res) => {
//   try {
//     const { agentId } = req.params;
//     const { content, rating } = req.body;
//     const userId = req.user.uid;
//     const userName = req.user.displayName || req.user.email.split('@')[0];
    
//     // Validate input
//     if (!content || !content.trim()) {
//       return res.status(400).json({ error: 'Review content is required' });
//     }
    
//     if (!rating || rating < 1 || rating > 5) {
//       return res.status(400).json({ error: 'Rating must be between 1 and 5' });
//     }
    
//     // Check if agent exists
//     const agentRef = db.collection('agents').doc(agentId);
//     const agentDoc = await agentRef.get();
    
//     if (!agentDoc.exists) {
//       return res.status(404).json({ error: 'Agent not found' });
//     }
    
//     // Create review document
//     const reviewData = {
//       agentId,
//       userId,
//       userName,
//       content,
//       rating,
//       createdAt: new Date().toISOString()
//     };
    
//     const reviewRef = await db.collection('agent_reviews').add(reviewData);
    
//     // Update agent's rating
//     const agentData = agentDoc.data();
//     const currentRating = agentData.rating || { average: 0, count: 0 };
//     const reviews = agentData.reviews || [];
    
//     // Calculate new average
//     const totalRating = (currentRating.average * currentRating.count) + rating;
//     const newCount = currentRating.count + 1;
//     const newAverage = totalRating / newCount;
    
//     // Add review to agent document
//     const newReview = {
//       id: reviewRef.id,
//       userId,
//       userName,
//       content,
//       rating,
//       createdAt: new Date().toISOString()
//     };
    
//     // Update agent document
//     await agentRef.update({
//       rating: {
//         average: newAverage,
//         count: newCount
//       },
//       reviews: admin.firestore.FieldValue.arrayUnion(newReview)
//     });
    
//     res.status(201).json({
//       success: true,
//       reviewId: reviewRef.id,
//       newRating: {
//         average: newAverage,
//         count: newCount
//       }
//     });
    
//   } catch (error) {
//     console.error('Error adding review:', error);
//     res.status(500).json({ error: 'Failed to add review' });
//   }
// });

// Toggle like on an agent
router.post('/:agentId/toggle-like', validateFirebaseToken, async (req, res) => {
  try {
    const { agentId } = req.params;
    const userId = req.user.uid;
    
    // Check if agent exists
    const agentRef = db.collection('agents').doc(agentId);
    const agentDoc = await agentRef.get();
    
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const agentData = agentDoc.data();
    const likes = agentData.likes || [];
    const userLikedIndex = likes.indexOf(userId);
    
    let updatedLikes;
    let liked;
    
    if (userLikedIndex >= 0) {
      // User already liked, remove the like
      updatedLikes = likes.filter(id => id !== userId);
      liked = false;
    } else {
      // User hasn't liked, add the like
      updatedLikes = [...likes, userId];
      liked = true;
    }
    
    // Update agent document
    await agentRef.update({
      likes: updatedLikes
    });
    
    res.json({
      success: true,
      liked,
      likesCount: updatedLikes.length
    });
    
  } catch (error) {
    console.error('Error toggling like:', error);
    res.status(500).json({ error: 'Failed to toggle like' });
  }
});

// Check if user has liked an agent
router.get('/:id/user-like-status', validateFirebaseToken, async (req, res) => {
  try {
    const agentId = req.params.id;
    const userId = req.user.uid;
    
    // Get the agent document to check if the user is in the likes array
    const agentRef = db.collection('agents').doc(agentId);
    const agentDoc = await agentRef.get();
    
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const agentData = agentDoc.data();
    const likes = agentData.likes || [];
    const liked = Array.isArray(likes) ? likes.includes(userId) : false;
    const likesCount = Array.isArray(likes) ? likes.length : 0;
    
    return res.json({
      liked,
      likesCount
    });
    
  } catch (error) {
    console.error('Error checking like status:', error);
    res.status(500).json({ error: 'Failed to check like status' });
  }
});

// Run the database update script programmatically
router.post('/update-collections', async (req, res) => {
  try {
    // Import the update script functions
    const { initializeCollections } = require('../../scripts/updateAgentsCollection');
    
    // Run the initialization
    await initializeCollections();
    
    res.json({ success: true, message: 'Agent collections updated successfully' });
  } catch (error) {
    console.error('Error running update script:', error);
    res.status(500).json({ error: 'Failed to update collections' });
  }
});

// Protected endpoints (require authentication)
router.get('/wishlists', validateFirebaseToken, agentsController.getWishlists);
router.post('/wishlists/:agentId', validateFirebaseToken, agentsController.toggleWishlist);
router.get('/wishlists/:wishlistId', validateFirebaseToken, agentsController.getWishlistById);

// Admin endpoints for agent management (require admin role)
// Use upload middleware to handle file uploads - set up fields for image, icon, and JSON file
router.post('/', validateFirebaseToken, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'jsonFile', maxCount: 1 }
]), agentsController.createAgent);

// Also update the patch route to handle file uploads
router.patch('/:agentId', validateFirebaseToken, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'jsonFile', maxCount: 1 }
]), agentsController.updateAgent);

// Add PUT route for compatibility with frontend API calls
router.put('/:agentId', validateFirebaseToken, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'jsonFile', maxCount: 1 }
]), agentsController.updateAgent);

router.delete('/:agentId', validateFirebaseToken, agentsController.deleteAgent);

// Development endpoint - only available in development environment
if (process.env.NODE_ENV === 'development') {
  router.post('/seed', agentsController.seedAgents);
}

// Get agent stats (download count, etc.) - public endpoint
// router.get('/:agentId/stats', publicCacheMiddleware({ duration: 30 }), async (req, res) => {
//   try {
//     const { agentId } = req.params;
    
//     if (!agentId) {
//       return res.status(400).json({ error: 'Agent ID is required' });
//     }
    
//     // Check if agent exists
//     const agentRef = db.collection('agents').doc(agentId);
//     const agentDoc = await agentRef.get();
    
//     if (!agentDoc.exists) {
//       return res.status(404).json({ error: 'Agent not found' });
//     }
    
//     const agentData = agentDoc.data();
    
//     // Return relevant public stats
//     return res.json({
//       downloadCount: agentData.downloadCount || 0,
//       viewCount: agentData.viewCount || 0,
//       rating: agentData.rating || { average: 0, count: 0 },
//       reviewCount: agentData.reviews?.length || 0,
//       likesCount: Array.isArray(agentData.likes) ? agentData.likes.length : (agentData.likes || 0)
//     });
    
//   } catch (error) {
//     console.error('Error fetching agent stats:', error);
//     return res.status(500).json({ 
//       error: 'Failed to fetch agent stats',
//       message: error.message
//     });
//   }
// });

// Increment download count - works for both authenticated and unauthenticated users
router.post('/:agentId/increment-downloads', async (req, res) => {
  try {
    const { agentId } = req.params;
    
    // Check if agent exists
    const agentRef = db.collection('agents').doc(agentId);
    const agentDoc = await agentRef.get();
    
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Increment download count
    await agentRef.update({
      downloadCount: admin.firestore.FieldValue.increment(1)
    });
    
    res.json({ 
      success: true,
      message: 'Download count incremented successfully'
    });
    
  } catch (error) {
    console.error('Error incrementing download count:', error);
    res.status(500).json({ error: 'Failed to increment download count' });
  }
});

// ===== Adding endpoints from api.js below =====

// Agent Downloads
router.post('/:id/download', validateFirebaseToken, async (req, res) => {
  const agentId = req.params.id;
  const userId = req.user.uid;
  
  try {
    // Create a JavaScript Date object for the download timestamp
    const jsDate = new Date();
    
    // Get agent data
    const agentDoc = await db.collection('agents').doc(agentId).get();
    
    if (!agentDoc.exists) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }
    
    const agentData = agentDoc.data();
    
    // Get price - for purchasing tracking
    const price = typeof agentData.price === 'object' ? 
      (agentData.price.basePrice || 0) : 
      (agentData.price || 0);
    
    // Update user's downloads array
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (userDoc.exists) {
      const userData = userDoc.data();
      const downloads = userData.downloads || [];
      
      // Check if user already has this download recorded
      const existingDownload = downloads.find(d => d.agentId === agentId);
      
      if (!existingDownload) {
        // Add to downloads array - using regular Date instead of serverTimestamp
        await userRef.update({
          downloads: admin.firestore.FieldValue.arrayUnion({
            agentId,
            id: agentId,
            title: agentData.title || 'Unknown Agent',
            imageUrl: agentData.imageUrl || null,
            downloadDate: jsDate, // Use JavaScript Date instead of serverTimestamp
            price: price,
            isFree: price === 0
          })
        });
      }
    }
    
    // Increment agent download count
    await incrementAgentDownloadCount(agentId);
    
    // Return success with download URL
    res.json({
      success: true,
      message: 'Download processed successfully',
      downloadUrl: agentData.jsonFileUrl,
      agent: {
        id: agentId,
        ...agentData,
        downloadDate: new Date() // Also use a regular Date here
      }
    });
  } catch (error) {
    console.error('Error processing download:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error processing download',
      error: error.message
    });
  }
});

// Check if user can review an agent
router.get('/:id/can-review', validateFirebaseToken, async (req, res) => {
  try {
    const agentId = req.params.id;
    const userId = req.user.uid;
    
    // Get user data
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      return res.status(404).json({ 
        canReview: false, 
        reason: 'User not found' 
      });
    }
    
    const userData = userDoc.data();
    
    // Check if user is admin
    if (userData.role === 'admin') {
      return res.json({ 
        canReview: true, 
        reason: 'Admin user' 
      });
    }
    
    // Check if user has purchased the agent
    if (userData.purchases && Array.isArray(userData.purchases)) {
      const hasPurchased = userData.purchases.some(
        purchase => purchase.agentId === agentId || purchase.productId === agentId
      );
      
      if (hasPurchased) {
        return res.json({ 
          canReview: true, 
          reason: 'Verified purchase' 
        });
      }
    }
    
    // Check if user has downloaded the agent
    if (userData.downloads && Array.isArray(userData.downloads)) {
      const hasDownloaded = userData.downloads.some(
        download => download.agentId === agentId || download.id === agentId
      );
      
      if (hasDownloaded) {
        return res.json({ 
          canReview: true, 
          reason: 'Downloaded agent' 
        });
      }
    }
    
    // Check downloads collection as backup
    const downloadsQuery = await db.collection('agent_downloads')
      .where('agentId', '==', agentId)
      .where('userId', '==', userId)
      .limit(1)
      .get();
    
    if (!downloadsQuery.empty) {
      return res.json({ 
        canReview: true, 
        reason: 'Downloaded agent' 
      });
    }
    
    // User hasn't purchased or downloaded
    return res.json({ 
      canReview: false, 
      reason: 'You must purchase or download this agent before reviewing' 
    });
    
  } catch (error) {
    console.error('Error checking review eligibility:', error);
    res.status(500).json({ 
      canReview: false, 
      reason: 'Error checking eligibility' 
    });
  }
});

// Free Agent Download
router.post('/:id/free-download', validateFirebaseToken, async (req, res) => {
  const agentId = req.params.id;
  const userId = req.user.uid;
  
  try {
    // Create a JavaScript Date object for the download timestamp
    const jsDate = new Date();
    
    // Get agent data
    const agentDoc = await db.collection('agents').doc(agentId).get();
    
    if (!agentDoc.exists) {
      return res.status(404).json({ success: false, message: 'Agent not found' });
    }
    
    const agentData = agentDoc.data();
    
    // Verify agent is free
    if (agentData.price !== 0) {
      return res.status(403).json({ success: false, message: 'This agent is not free' });
    }
    
    // Update user's downloads array
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();
    
    if (userDoc.exists) {
      const userData = userDoc.data();
      const downloads = userData.downloads || [];
      
      // Check if user already has this download recorded
      const existingDownload = downloads.find(d => d.agentId === agentId);
      
      if (!existingDownload) {
        // Add to downloads array - using regular Date instead of serverTimestamp
        await userRef.update({
          downloads: admin.firestore.FieldValue.arrayUnion({
            agentId,
            id: agentId,
            title: agentData.title || 'Unknown Agent',
            imageUrl: agentData.imageUrl || null,
            downloadDate: jsDate, // Use JavaScript Date instead of serverTimestamp
            price: 0,
            isFree: true
          })
        });
      }
    }
    
    // Increment agent download count
    await incrementAgentDownloadCount(agentId);
    
    // Return success with download info
    res.json({
      success: true,
      message: 'Free agent download processed successfully',
      downloadUrl: agentData.jsonFileUrl || agentData.downloadUrl || agentData.fileUrl,
      agent: {
        id: agentId,
        ...agentData,
        downloadDate: new Date() // Also use a regular Date here
      }
    });
  } catch (error) {
    console.error('Error processing free download:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error processing free download',
      error: error.message
    });
  }
});

// Download file proxy endpoint
router.get('/:id/download-file', async (req, res) => {
  try {
    const fileUrl = req.query.url;
    const agentId = req.params.id;
    
    console.log(`[DOWNLOAD PROXY] Request received for agent ${agentId}, URL: ${fileUrl}`);
    
    if (!fileUrl) {
      console.log('[DOWNLOAD PROXY] Missing URL parameter');
      return res.status(400).json({ success: false, message: 'File URL is required' });
    }
    
    // Log the request details to help debug
    console.log(`[DOWNLOAD PROXY] Proxying download for agent ${agentId}, file: ${fileUrl}`);
    
    // Use axios to download the file
    const axios = require('axios');
    const response = await axios({
      method: 'GET',
      url: fileUrl,
      responseType: 'stream'
    });
    
    console.log(`[DOWNLOAD PROXY] File fetched successfully, status: ${response.status}`);
    console.log(`[DOWNLOAD PROXY] Response headers:`, response.headers);
    
    // Get the filename from the URL
    const urlParts = fileUrl.split('/');
    const filename = urlParts[urlParts.length - 1];
    
    // Set headers to force download
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // If content type is in the response, use it
    if (response.headers['content-type']) {
      res.setHeader('Content-Type', response.headers['content-type']);
    } else {
      // Default to application/json for JSON files
      if (filename.endsWith('.json')) {
        res.setHeader('Content-Type', 'application/json');
      } else {
        res.setHeader('Content-Type', 'application/octet-stream');
      }
    }
    
    console.log(`[DOWNLOAD PROXY] Sending file to client: ${filename}`);
    
    // Pipe the file stream to the response
    response.data.pipe(res);
  } catch (error) {
    console.error('[DOWNLOAD PROXY] Error proxying file download:', error);
    
    // Return a more helpful error response
    res.status(500).json({ 
      success: false, 
      message: 'Error downloading file',
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Add a new admin route for migrating download counts

module.exports = router; 