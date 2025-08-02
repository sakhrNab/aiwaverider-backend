const express = require('express');
const router = express.Router();
const { auth } = require('../../middleware/authenticationMiddleware');
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
router.post('/', auth, upload.single('image'), createPost);
router.put('/:postId', auth, upload.single('image'), updatePost);
router.delete('/:postId', auth, deletePost);

// Like routes
router.post('/:postId/like', auth, toggleLike);

// Comment routes
router.post('/:postId/comments', auth, addComment);
router.put('/:postId/comments/:commentId', auth, updateComment);
router.delete('/:postId/comments/:commentId', auth, deleteComment);
router.post('/:postId/comments/:commentId/like', auth, likeComment);
router.post('/:postId/comments/:commentId/unlike', auth, unlikeComment);

// Track post view
router.post('/:postId/view', incrementViews);

// Admin route to initialize view counts
router.post('/initialize-views', auth, initializeViewCounts);

module.exports = router; 