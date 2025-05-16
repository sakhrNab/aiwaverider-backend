const express = require('express');
const router = express.Router();
const validateFirebaseToken = require('../../middleware/authenticationMiddleware').validateFirebaseToken;
const { 
  createPost, 
  getPosts, 
  getPostById, 
  updatePost, 
  deletePost,
  toggleLike,
  getMultiCategoryPosts,
  getBatchComments,
  getPostComments,
  addComment,
  likeComment,
  unlikeComment,
  deleteComment,
  updateComment,
  incrementViews,
  initializeViewCounts
} = require('../../controllers/posts/postsController');
const admin = require('firebase-admin');
const upload = require('../../middleware/upload');
// Initialize Firestore
const db = admin.firestore();

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes
router.get('/', getPosts);
router.get('/multi-category', getMultiCategoryPosts);
router.get('/batch-comments', getBatchComments);
router.post('/batch-comments', getBatchComments);
router.get('/:postId', getPostById);
router.get('/:postId/comments', getPostComments);

// Protected routes
router.post('/', validateFirebaseToken, upload.single('image'), createPost);
router.put('/:postId', validateFirebaseToken, upload.single('image'), updatePost);
router.delete('/:postId', validateFirebaseToken, deletePost);

// Like routes
router.post('/:postId/like', validateFirebaseToken, toggleLike);

// Comment routes
router.post('/:postId/comments', validateFirebaseToken, addComment);
router.put('/:postId/comments/:commentId', validateFirebaseToken, updateComment);
router.delete('/:postId/comments/:commentId', validateFirebaseToken, deleteComment);
router.post('/:postId/comments/:commentId/like', validateFirebaseToken, likeComment);
router.post('/:postId/comments/:commentId/unlike', validateFirebaseToken, unlikeComment);

// Track post view
router.post('/:postId/view', incrementViews);

// Admin route to initialize view counts
router.post('/initialize-views', initializeViewCounts);

module.exports = router; 