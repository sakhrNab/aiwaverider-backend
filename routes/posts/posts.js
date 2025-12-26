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

/**
 * @swagger
 * /api/posts/health:
 *   get:
 *     summary: Posts service health check
 *     description: Check the health status of the posts service
 *     tags: [Posts]
 *     responses:
 *       200:
 *         description: Posts service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2024-01-15T10:30:00.000Z"
 *       500:
 *         description: Internal server error
 */
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * @swagger
 * /api/posts:
 *   get:
 *     summary: Get all posts
 *     description: Retrieve a paginated list of all posts with optional filtering
 *     tags: [Posts]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of posts per page
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by post category
 *         example: "tech"
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for post title and content
 *         example: "AI technology"
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [createdAt, updatedAt, views, likes]
 *           default: createdAt
 *         description: Sort field
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *     responses:
 *       200:
 *         description: Posts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginationResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Post'
 *       500:
 *         description: Internal server error
 */
router.get('/', getPosts);

/**
 * @swagger
 * /api/posts/multi-category:
 *   get:
 *     summary: Get multi-category posts
 *     description: Retrieve posts from multiple categories
 *     tags: [Posts]
 *     parameters:
 *       - in: query
 *         name: categories
 *         schema:
 *           type: string
 *         description: Comma-separated list of categories
 *         example: "tech,ai,development"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *         description: Number of posts per category
 *     responses:
 *       200:
 *         description: Multi-category posts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       $ref: '#/components/schemas/Post'
 *       500:
 *         description: Internal server error
 */
router.get('/multi-category', getMultiCategoryPosts);

/**
 * @swagger
 * /api/posts/batch-comments:
 *   get:
 *     summary: Get batch comments
 *     description: Retrieve comments for multiple posts in a single request
 *     tags: [Posts]
 *     parameters:
 *       - in: query
 *         name: postIds
 *         schema:
 *           type: string
 *         description: Comma-separated list of post IDs
 *         example: "post1,post2,post3"
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Number of comments per post
 *     responses:
 *       200:
 *         description: Batch comments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       $ref: '#/components/schemas/Comment'
 *       400:
 *         description: Bad request - Invalid post IDs
 *       500:
 *         description: Internal server error
 *   post:
 *     summary: Get batch comments (POST)
 *     description: Retrieve comments for multiple posts using POST method
 *     tags: [Posts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - postIds
 *             properties:
 *               postIds:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of post IDs
 *                 example: ["post1", "post2", "post3"]
 *               limit:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 100
 *                 default: 10
 *                 description: Number of comments per post
 *     responses:
 *       200:
 *         description: Batch comments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       $ref: '#/components/schemas/Comment'
 *       400:
 *         description: Bad request - Invalid post IDs
 *       500:
 *         description: Internal server error
 */
router.get('/batch-comments', getBatchComments);
router.post('/batch-comments', getBatchComments);

/**
 * @swagger
 * /api/posts/{postId}:
 *   get:
 *     summary: Get post by ID
 *     description: Retrieve a specific post by its ID
 *     tags: [Posts]
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *         example: "post-123"
 *     responses:
 *       200:
 *         description: Post retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Post'
 *       404:
 *         description: Post not found
 *       500:
 *         description: Internal server error
 */
router.get('/:postId', getPostById);

/**
 * @swagger
 * /api/posts/{postId}/comments:
 *   get:
 *     summary: Get post comments
 *     description: Retrieve all comments for a specific post
 *     tags: [Posts]
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *         example: "post-123"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 20
 *         description: Number of comments per page
 *     responses:
 *       200:
 *         description: Post comments retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/PaginationResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Comment'
 *       404:
 *         description: Post not found
 *       500:
 *         description: Internal server error
 */
router.get('/:postId/comments', getPostComments);

/**
 * @swagger
 * /api/posts:
 *   post:
 *     summary: Create new post
 *     description: Create a new post (authentication required)
 *     tags: [Posts]
 *     security:
 *       - FirebaseAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - content
 *             properties:
 *               title:
 *                 type: string
 *                 description: Post title
 *                 example: "My Amazing Post"
 *               content:
 *                 type: string
 *                 description: Post content
 *                 example: "This is the content of my post..."
 *               category:
 *                 type: string
 *                 description: Post category
 *                 example: "tech"
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags
 *                 example: "ai,technology,innovation"
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Post featured image
 *               isPublished:
 *                 type: boolean
 *                 description: Whether the post is published
 *                 default: true
 *     responses:
 *       201:
 *         description: Post created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Post'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       500:
 *         description: Internal server error
 */
router.post('/', auth, upload.single('image'), createPost);

/**
 * @swagger
 * /api/posts/{postId}:
 *   put:
 *     summary: Update post
 *     description: Update an existing post (authentication required)
 *     tags: [Posts]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *         example: "post-123"
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: Post title
 *                 example: "Updated Post Title"
 *               content:
 *                 type: string
 *                 description: Post content
 *                 example: "Updated content..."
 *               category:
 *                 type: string
 *                 description: Post category
 *                 example: "tech"
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags
 *                 example: "ai,technology,innovation"
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Post featured image
 *               isPublished:
 *                 type: boolean
 *                 description: Whether the post is published
 *     responses:
 *       200:
 *         description: Post updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Post'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Post not found
 *       500:
 *         description: Internal server error
 */
router.put('/:postId', auth, upload.single('image'), updatePost);

/**
 * @swagger
 * /api/posts/{postId}:
 *   delete:
 *     summary: Delete post
 *     description: Delete a post (authentication required)
 *     tags: [Posts]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *         example: "post-123"
 *     responses:
 *       200:
 *         description: Post deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Post deleted successfully"
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Post not found
 *       500:
 *         description: Internal server error
 */
router.delete('/:postId', auth, deletePost);

/**
 * @swagger
 * /api/posts/{postId}/like:
 *   post:
 *     summary: Toggle post like
 *     description: Like or unlike a post (authentication required)
 *     tags: [Posts]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *         example: "post-123"
 *     responses:
 *       200:
 *         description: Like status toggled successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 liked:
 *                   type: boolean
 *                   description: Current like status
 *                   example: true
 *                 likesCount:
 *                   type: integer
 *                   description: Total number of likes
 *                   example: 42
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Post not found
 *       500:
 *         description: Internal server error
 */
router.post('/:postId/like', auth, toggleLike);

/**
 * @swagger
 * /api/posts/{postId}/comments:
 *   post:
 *     summary: Add comment to post
 *     description: Add a comment to a post (authentication required)
 *     tags: [Posts]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *         example: "post-123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 description: Comment content
 *                 example: "Great post! Thanks for sharing."
 *               parentCommentId:
 *                 type: string
 *                 description: Parent comment ID for replies
 *                 example: "comment-456"
 *     responses:
 *       201:
 *         description: Comment added successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Comment'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Post not found
 *       500:
 *         description: Internal server error
 */
router.post('/:postId/comments', auth, addComment);

/**
 * @swagger
 * /api/posts/{postId}/comments/{commentId}:
 *   put:
 *     summary: Update comment
 *     description: Update a comment (authentication required)
 *     tags: [Posts]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *         example: "post-123"
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Comment ID
 *         example: "comment-456"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               content:
 *                 type: string
 *                 description: Updated comment content
 *                 example: "Updated comment content"
 *     responses:
 *       200:
 *         description: Comment updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Comment'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Comment not found
 *       500:
 *         description: Internal server error
 *   delete:
 *     summary: Delete comment
 *     description: Delete a comment (authentication required)
 *     tags: [Posts]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *         example: "post-123"
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Comment ID
 *         example: "comment-456"
 *     responses:
 *       200:
 *         description: Comment deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Comment deleted successfully"
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Comment not found
 *       500:
 *         description: Internal server error
 */
router.put('/:postId/comments/:commentId', auth, updateComment);
router.delete('/:postId/comments/:commentId', auth, deleteComment);

/**
 * @swagger
 * /api/posts/{postId}/comments/{commentId}/like:
 *   post:
 *     summary: Like comment
 *     description: Like a comment (authentication required)
 *     tags: [Posts]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *         example: "post-123"
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Comment ID
 *         example: "comment-456"
 *     responses:
 *       200:
 *         description: Comment liked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 liked:
 *                   type: boolean
 *                   example: true
 *                 likesCount:
 *                   type: integer
 *                   example: 5
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Comment not found
 *       500:
 *         description: Internal server error
 */
router.post('/:postId/comments/:commentId/like', auth, likeComment);

/**
 * @swagger
 * /api/posts/{postId}/comments/{commentId}/unlike:
 *   post:
 *     summary: Unlike comment
 *     description: Unlike a comment (authentication required)
 *     tags: [Posts]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *         example: "post-123"
 *       - in: path
 *         name: commentId
 *         required: true
 *         schema:
 *           type: string
 *         description: Comment ID
 *         example: "comment-456"
 *     responses:
 *       200:
 *         description: Comment unliked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 liked:
 *                   type: boolean
 *                   example: false
 *                 likesCount:
 *                   type: integer
 *                   example: 4
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Comment not found
 *       500:
 *         description: Internal server error
 */
router.post('/:postId/comments/:commentId/unlike', auth, unlikeComment);

/**
 * @swagger
 * /api/posts/{postId}/view:
 *   post:
 *     summary: Track post view
 *     description: Increment the view count for a post
 *     tags: [Posts]
 *     parameters:
 *       - in: path
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: Post ID
 *         example: "post-123"
 *     responses:
 *       200:
 *         description: View tracked successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 viewsCount:
 *                   type: integer
 *                   description: Updated view count
 *                   example: 150
 *       404:
 *         description: Post not found
 *       500:
 *         description: Internal server error
 */
router.post('/:postId/view', incrementViews);

/**
 * @swagger
 * /api/posts/initialize-views:
 *   post:
 *     summary: Initialize view counts
 *     description: Initialize view counts for all posts (admin only)
 *     tags: [Posts]
 *     security:
 *       - FirebaseAuth: []
 *       - AdminToken: []
 *     responses:
 *       200:
 *         description: View counts initialized successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "View counts initialized for all posts"
 *                 processedCount:
 *                   type: integer
 *                   example: 150
 *       401:
 *         description: Unauthorized - Authentication required
 *       403:
 *         description: Forbidden - Admin access required
 *       500:
 *         description: Internal server error
 */
router.post('/initialize-views', auth, initializeViewCounts);

module.exports = router; 