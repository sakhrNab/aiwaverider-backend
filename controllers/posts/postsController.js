// backend/controllers/postsController.js

const crypto = require('crypto');
const sanitizeUtils = require('../../utils/sanitize');
const {
  uploadImageToStorage,
  deleteImageFromStorage
} = require('../../utils/storage');
const { pool } = require('../../config/database');
const {
  getCache,
  setCache,
  deleteCache,
  deleteCacheByPattern,
  generatePostsCacheKey,
  generatePostCacheKey,
  generateCommentsCacheKey,
} = require('../../utils/cache');
const { indexSinglePost, removeFromIndex } = require('../../services/rag/qdrantService');

const normalizePostRow = (row) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  category: row.category,
  imageUrl: row.image_url,
  imageFilename: row.image_filename,
  additionalHTML: row.additional_html,
  graphHtml: row.graph_html,
  createdBy: row.created_by,
  createdByUsername: row.created_by_username,
  views: row.views,
  likes: row.likes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const createPost = async (req, res) => {
  try {
    const { title, description, category, additionalHTML, graphHTML } = req.body;
    const user = req.user;

    // Add validation for authenticated users
    if (!user?.uid) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Check if user is admin
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin privileges required to create posts.' });
    }

    // Validate required fields
    if (!title || !description || !category) {
      return res.status(400).json({ error: 'Title, description, and category are required.' });
    }

    // Handle image upload if provided
    let imageUrl = null;
    let imageFilename = null;
    if (req.file) {
      const uploadResult = await uploadImageToStorage(
        req.file.buffer,
        req.file.originalname,
        'posts'
      );

      if (!uploadResult || !uploadResult.url || !uploadResult.filename) {
        throw new Error('Image upload failed: Missing URL or filename.');
      }

      imageUrl = uploadResult.url;
      imageFilename = uploadResult.filename;
    }

    // Get username from users table
    const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [user.uid]);
    const username = userResult.rows.length > 0 ? userResult.rows[0].username : 'Unknown User';

    // Sanitize inputs
    const sanitizedAdditionalHTML = sanitizeUtils.sanitizeContent(additionalHTML || '');
    const sanitizedGraphHTML = sanitizeUtils.sanitizeContent(graphHTML || '');

    const postId = crypto.randomUUID();

    // Add post to PostgreSQL
    const insertResult = await pool.query(
      `INSERT INTO posts (id, title, description, category, image_url, image_filename, additional_html, graph_html, created_by, created_by_username, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       RETURNING *`,
      [postId, title, description, category, imageUrl, imageFilename, sanitizedAdditionalHTML, sanitizedGraphHTML, user.uid || null, username]
    );

    const newPost = normalizePostRow(insertResult.rows[0]);

    // Invalidate relevant caches
    await deleteCacheByPattern('posts:*');
    await setCache(generatePostCacheKey(postId), newPost);

    // Auto-index into Qdrant (fire-and-forget)
    indexSinglePost(newPost).catch(() => {});

    return res.json({
      message: 'Post created successfully.',
      post: newPost,
    });
  } catch (err) {
    console.error('Error in createPost:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

const getPosts = async (req, res) => {
  try {
    const { category = 'All', limit = 10, startAfter = null } = req.query;

    // Generate cache key
    const cacheKey = generatePostsCacheKey({ category, limit, startAfter });

    // Try to get from cache first
    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

    // If not in cache, query PostgreSQL
    const params = [];
    let paramIndex = 1;
    let whereConditions = [];

    if (category !== 'All') {
      whereConditions.push(`category = $${paramIndex++}`);
      params.push(category);
    }

    if (startAfter) {
      // Cursor-based pagination: get the created_at of the startAfter post
      const cursorResult = await pool.query('SELECT created_at FROM posts WHERE id = $1', [startAfter]);
      if (cursorResult.rows.length > 0) {
        whereConditions.push(`created_at < $${paramIndex++}`);
        params.push(cursorResult.rows[0].created_at);
      }
    }

    const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
    params.push(parseInt(limit));

    const query = `SELECT * FROM posts ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex}`;
    const result = await pool.query(query, params);
    const posts = result.rows.map(normalizePostRow);

    const lastPost = posts.length > 0 ? posts[posts.length - 1] : null;

    const response = {
      posts,
      lastPostId: lastPost ? lastPost.id : null,
      hasMore: posts.length === parseInt(limit)
    };

    // Cache the response
    await setCache(cacheKey, response);

    return res.json(response);
  } catch (err) {
    console.error('Error in getPosts:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

const getPostById = async (req, res) => {
  try {
    const { postId } = req.params;
    const skipCache = req.query.skipCache === 'true';

    // Try to get from cache first (unless skipCache is true)
    if (!skipCache) {
      const cacheKey = generatePostCacheKey(postId);
      const cachedPost = await getCache(cacheKey);
      if (cachedPost) {
        console.log(`Serving post ${postId} from cache`);
        return res.json(cachedPost);
      }
    } else {
      console.log(`Skipping cache for post ${postId} as requested by client`);
    }

    // If skipCache=true or not in cache, get from PostgreSQL
    const result = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const post = normalizePostRow(result.rows[0]);

    // Cache the post (unless skipCache is true)
    if (!skipCache) {
      const cacheKey = generatePostCacheKey(postId);
      await setCache(cacheKey, post);
      console.log(`Cached post ${postId}`);
    }

    console.log(`Serving fresh post ${postId} from PostgreSQL, views: ${post.views || 0}`);
    return res.json(post);
  } catch (err) {
    console.error('Error in getPostById:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

const updatePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const updates = req.body;
    const user = req.user;

    // Validate user and post ownership
    const postResult = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const postData = normalizePostRow(postResult.rows[0]);
    if (postData.created_by !== user.uid && user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized to update this post.' });
    }

    // Handle image updates if needed
    if (req.file) {
      // Delete old image if it exists
      if (postData.image_filename) {
        await deleteImageFromStorage(postData.image_filename);
      }

      const uploadResult = await uploadImageToStorage(
        req.file.buffer,
        req.file.originalname,
        'posts'
      );

      if (!uploadResult || !uploadResult.url || !uploadResult.filename) {
        throw new Error('Image upload failed');
      }

      updates.imageUrl = uploadResult.url;
      updates.imageFilename = uploadResult.filename;
    }

    // Sanitize HTML content if present
    if (updates.additionalHTML) {
      updates.additionalHTML = sanitizeUtils.sanitizeContent(updates.additionalHTML);
    }
    if (updates.graphHTML) {
      updates.graphHTML = sanitizeUtils.sanitizeContent(updates.graphHTML);
    }

    // Build dynamic UPDATE query from updates object
    // Map camelCase keys to snake_case columns
    const columnMap = {
      title: 'title',
      description: 'description',
      category: 'category',
      imageUrl: 'image_url',
      imageFilename: 'image_filename',
      additionalHTML: 'additional_html',
      graphHTML: 'graph_html',
    };

    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      const column = columnMap[key];
      if (column) {
        setClauses.push(`${column} = $${paramIndex++}`);
        values.push(value);
      }
    }

    // Always update updated_at
    setClauses.push(`updated_at = NOW()`);

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    values.push(postId);
    const updateQuery = `UPDATE posts SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const updateResult = await pool.query(updateQuery, values);
    const updatedPost = normalizePostRow(updateResult.rows[0]);

    // Clear cache for this post
    await deleteCache(generatePostCacheKey(postId));
    await deleteCacheByPattern('posts:*'); // Clear all post lists

    // Auto-index updated post in Qdrant (fire-and-forget)
    indexSinglePost(updatedPost).catch(() => {});

    return res.json({
      message: 'Post updated successfully',
      post: updatedPost
    });
  } catch (error) {
    console.error('Error updating post:', error);
    return res.status(500).json({ error: 'Failed to update post' });
  }
};

const deletePost = async (req, res) => {
  try {
    const { postId } = req.params;
    const user = req.user;

    // Validate user and post ownership
    const postResult = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const postData = normalizePostRow(postResult.rows[0]);
    if (postData.created_by !== user.uid && user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized to delete this post.' });
    }

    // Delete image from storage if it exists
    if (postData.image_filename) {
      await deleteImageFromStorage(postData.image_filename);
    }

    // Delete comments for this post and then the post itself in a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM comments WHERE post_id = $1', [postId]);
      await client.query('DELETE FROM posts WHERE id = $1', [postId]);
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }

    // Invalidate caches
    await deleteCacheByPattern('posts:*');
    await deleteCache(generatePostCacheKey(postId));
    await deleteCache(generateCommentsCacheKey(postId));

    // Remove deleted post from Qdrant index (fire-and-forget)
    removeFromIndex('posts', postId).catch(() => {});

    return res.json({ success: true, message: 'Post deleted successfully.' });
  } catch (err) {
    console.error('Error in deletePost:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

const toggleLike = async (req, res) => {
  try {
    const { postId } = req.params;
    const userId = req.user.uid;
    console.log(`User ${userId} toggling like on post ${postId}`);

    if (!userId) {
      console.log('Authentication required for like action');
      return res.status(401).json({ error: 'Authentication required' });
    }

    const postResult = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);

    if (postResult.rows.length === 0) {
      console.log(`Post ${postId} not found`);
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = normalizePostRow(postResult.rows[0]);
    const likes = post.likes || [];
    const isLiked = likes.includes(userId);
    console.log(`Current like status for user ${userId} on post ${postId}: ${isLiked ? 'liked' : 'not liked'}`);

    // Toggle like
    try {
      if (isLiked) {
        console.log(`Removing like from user ${userId} on post ${postId}`);
        await pool.query(
          'UPDATE posts SET likes = array_remove(likes, $1) WHERE id = $2',
          [userId, postId]
        );
      } else {
        console.log(`Adding like from user ${userId} on post ${postId}`);
        await pool.query(
          'UPDATE posts SET likes = array_append(likes, $1) WHERE id = $2',
          [userId, postId]
        );
      }
    } catch (updateError) {
      console.error(`Error updating like status: ${updateError.message}`);
      return res.status(500).json({
        error: 'Failed to update like status',
        details: updateError.message
      });
    }

    // Get updated post
    const updatedResult = await pool.query('SELECT * FROM posts WHERE id = $1', [postId]);
    const updatedPost = normalizePostRow(updatedResult.rows[0]);

    // Double-check the like status was actually changed
    const updatedLikes = updatedPost.likes || [];
    const newIsLiked = updatedLikes.includes(userId);

    if (newIsLiked === isLiked) {
      console.warn(`Like status didn't change for user ${userId} on post ${postId}!`);
    } else {
      console.log(`Like status successfully changed to ${newIsLiked ? 'liked' : 'unliked'}`);
    }

    // Invalidate cache
    try {
      await deleteCache(generatePostCacheKey(postId));
      await deleteCacheByPattern('posts:*');
    } catch (cacheError) {
      console.error('Error invalidating cache:', cacheError);
      // Continue despite cache error
    }

    console.log(`Successfully ${isLiked ? 'unliked' : 'liked'} post ${postId}`);
    return res.json({
      success: true,
      message: isLiked ? 'Post unliked' : 'Post liked',
      updatedPost: updatedPost
    });
  } catch (err) {
    console.error('Error in toggleLike:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
};

// Add missing functions from index.js
const getMultiCategoryPosts = async (req, res) => {
  try {
    const { categories, limit } = req.query;
    if (!categories) {
      return res.status(400).json({ error: 'No categories provided.' });
    }

    const categoryArray = categories.split(',').map((c) => c.trim());
    const limitNumber = parseInt(limit, 10) || 5;
    const results = {};

    for (const cat of categoryArray) {
      let postsQuery;
      let postsParams;

      if (cat !== 'All') {
        postsQuery = 'SELECT * FROM posts WHERE category = $1 ORDER BY created_at DESC LIMIT $2';
        postsParams = [cat, limitNumber];
      } else {
        postsQuery = 'SELECT * FROM posts ORDER BY created_at DESC LIMIT $1';
        postsParams = [limitNumber];
      }

      const postsResult = await pool.query(postsQuery, postsParams);
      const postIds = postsResult.rows.map((row) => row.id);
      const postsForThisCategory = postsResult.rows.map((row) => ({
        ...row,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        comments: [],
      }));

      let allCommentsForThisCategory = [];
      if (postIds.length > 0) {
        const commentsResult = await pool.query(
          'SELECT * FROM comments WHERE post_id = ANY($1) ORDER BY created_at DESC',
          [postIds]
        );
        allCommentsForThisCategory = commentsResult.rows.map((row) => ({
          ...row,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        }));
      }

      const commentsByPostId = {};
      allCommentsForThisCategory.forEach((comment) => {
        if (!commentsByPostId[comment.post_id]) {
          commentsByPostId[comment.post_id] = [];
        }
        commentsByPostId[comment.post_id].push(comment);
      });

      postsForThisCategory.forEach((post) => {
        post.comments = commentsByPostId[post.id] || [];
      });

      results[cat] = postsForThisCategory;
    }

    return res.json({
      data: results,
    });
  } catch (err) {
    console.error('Error in getMultiCategoryPosts:', err);
    return res.status(500).json({ error: 'Internal server error.', details: err.message });
  }
};

const getBatchComments = async (req, res) => {
  try {
    // Support both GET (query params) and POST (request body) methods
    let postIds = [];

    if (req.method === 'POST' && req.body.postIds) {
      // Get postIds from request body (for the optimized client)
      postIds = Array.isArray(req.body.postIds)
        ? req.body.postIds
        : req.body.postIds.split(',');
    } else if (req.query.postIds) {
      // Support both comma-separated format and multiple parameter instances
      if (Array.isArray(req.query.postIds)) {
        // Handle case where Express parses repeated params as an array
        postIds = req.query.postIds;
      } else {
        // Handle comma-separated format
        postIds = req.query.postIds.split(',');
      }
    } else {
      return res.status(400).json({
        error: 'No postIds provided',
        message: 'Please provide postIds as a comma-separated list or as multiple parameters'
      });
    }

    // Filter out empty values and deduplicate
    postIds = [...new Set(postIds.filter(id => id && id.trim()))];

    if (!postIds.length) {
      return res.status(400).json({
        error: 'No valid postIds provided',
        message: 'Please provide at least one valid postId'
      });
    }

    console.log(`Processing batch comments request for ${postIds.length} posts:`, postIds);

    // Limit the number of posts we'll process at once
    if (postIds.length > 50) {
      console.warn(`Limiting batch request from ${postIds.length} to 50 posts`);
      postIds = postIds.slice(0, 50);
    }

    // Check cache first
    const cachingEnabled = req.query.skipCache !== 'true';
    const results = {};

    if (cachingEnabled) {
      // Check if all requested posts are in cache
      const cachedResults = {};
      let allCached = true;

      for (const postId of postIds) {
        const cacheKey = `comments:${postId}`;
        const cachedComments = await getCache(cacheKey);

        if (cachedComments) {
          try {
            cachedResults[postId] = JSON.parse(cachedComments);
          } catch (e) {
            console.error(`Error parsing cached comments for post ${postId}:`, e);
            allCached = false;
            break;
          }
        } else {
          allCached = false;
          break;
        }
      }

      // If all posts have cached comments, return them
      if (allCached) {
        console.log('Returning all batch comments from cache');
        return res.json(cachedResults);
      }
    }

    // Fetch comments for all posts using ANY($1) - no batch size limit needed with PostgreSQL
    console.log(`Fetching comments for ${postIds.length} posts`);

    try {
      const commentsResult = await pool.query(
        'SELECT * FROM comments WHERE post_id = ANY($1) ORDER BY created_at DESC',
        [postIds]
      );

      const allComments = commentsResult.rows.map(row => ({
        ...row,
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
      }));

      console.log(`Retrieved ${allComments.length} total comments`);

      // Group comments by post_id
      for (const comment of allComments) {
        if (!results[comment.post_id]) {
          results[comment.post_id] = [];
        }
        results[comment.post_id].push(comment);
      }
    } catch (error) {
      console.error(`Error fetching comments batch:`, error);
      // Return empty arrays for all posts on error
    }

    // Add empty arrays for posts with no comments
    for (const postId of postIds) {
      if (!results[postId]) {
        results[postId] = [];
      }
    }

    // Cache individual post comments
    if (cachingEnabled) {
      for (const [postId, comments] of Object.entries(results)) {
        const cacheKey = `comments:${postId}`;
        await setCache(cacheKey, JSON.stringify(comments), 60 * 5); // Cache for 5 minutes
      }
    }

    return res.json(results);
  } catch (err) {
    console.error('Error in getBatchComments:', err);
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
};

const getPostComments = async (req, res) => {
  try {
    const { postId } = req.params;
    const commentsResult = await pool.query(
      'SELECT * FROM comments WHERE post_id = $1 ORDER BY created_at DESC',
      [postId]
    );

    const allComments = [];
    const commentMap = new Map();

    for (const row of commentsResult.rows) {
      const likes = row.likes || [];
      let likedBy = [];

      if (likes.length > 0) {
        // Fetch usernames for users who liked this comment
        const usersResult = await pool.query(
          'SELECT id, username FROM users WHERE id = ANY($1)',
          [likes]
        );
        likedBy = usersResult.rows.map(u => ({ id: u.id, username: u.username }));
      }

      const comment = {
        id: row.id,
        postId: row.post_id,
        userId: row.user_id,
        text: row.text,
        username: row.username || 'Anonymous',
        userRole: row.user_role || 'user',
        likes: likes,
        likedBy: likedBy,
        parentCommentId: row.parent_comment_id || null,
        replies: [],
        createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
      };

      commentMap.set(row.id, comment);
    }

    for (const comment of commentMap.values()) {
      if (comment.parentCommentId) {
        const parentComment = commentMap.get(comment.parentCommentId);
        if (parentComment) {
          parentComment.replies.push(comment);
        } else {
          allComments.push(comment);
        }
      } else {
        allComments.push(comment);
      }
    }

    for (const comment of allComments) {
      if (comment.replies.length > 0) {
        comment.replies.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      }
    }

    return res.json(allComments);
  } catch (err) {
    console.error('Error in getPostComments:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

const addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const { commentText, parentCommentId } = req.body;

    const commentId = crypto.randomUUID();

    const insertResult = await pool.query(
      `INSERT INTO comments (id, post_id, text, parent_comment_id, user_id, username, created_at, updated_at, likes)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), '{}')
       RETURNING *`,
      [commentId, postId, commentText, parentCommentId || null, req.user.uid, req.user.username]
    );

    const newComment = insertResult.rows[0];

    await deleteCache(generateCommentsCacheKey(postId));
    await deleteCacheByPattern('batchComments_*');

    return res.json({ comment: newComment });
  } catch (err) {
    console.error('Error in addComment:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

const likeComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const uid = req.user.uid;
    console.log(`User ${uid} attempting to like comment ${commentId} for post ${postId}`);

    const commentResult = await pool.query('SELECT * FROM comments WHERE id = $1', [commentId]);

    if (commentResult.rows.length === 0) {
      console.log(`Comment ${commentId} not found`);
      return res.status(404).json({ error: 'Comment not found.' });
    }

    let commentData = commentResult.rows[0];
    let likes = commentData.likes || [];

    if (!likes.includes(uid)) {
      console.log(`Adding user ${uid} to likes for comment ${commentId}`);
      await pool.query(
        'UPDATE comments SET likes = array_append(likes, $1) WHERE id = $2',
        [uid, commentId]
      );
    } else {
      console.log(`User ${uid} already liked comment ${commentId}, no changes made`);
    }

    // Get updated comment
    const updatedResult = await pool.query('SELECT * FROM comments WHERE id = $1', [commentId]);
    const updatedData = updatedResult.rows[0];
    const updatedLikes = updatedData.likes || [];

    // Fetch usernames for users who liked this comment
    let likedBy = [];
    if (updatedLikes.length > 0) {
      const usersResult = await pool.query(
        'SELECT id, username FROM users WHERE id = ANY($1)',
        [updatedLikes]
      );
      likedBy = usersResult.rows.map(u => ({ id: u.id, username: u.username }));
    }

    const updatedComment = {
      id: updatedData.id,
      postId: updatedData.post_id,
      userId: updatedData.user_id,
      text: updatedData.text,
      username: updatedData.username,
      userRole: updatedData.user_role,
      likes: updatedLikes,
      likedBy,
      parentCommentId: updatedData.parent_comment_id,
      createdAt: updatedData.created_at ? new Date(updatedData.created_at).toISOString() : null
    };

    console.log(`Successfully processed like for comment ${commentId}, returning updated comment`);
    return res.json({ updatedComment });
  } catch (err) {
    console.error('Error in likeComment:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

const unlikeComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const uid = req.user.uid;
    console.log(`User ${uid} attempting to unlike comment ${commentId} for post ${postId}`);

    const commentResult = await pool.query('SELECT * FROM comments WHERE id = $1', [commentId]);

    if (commentResult.rows.length === 0) {
      console.log(`Comment ${commentId} not found`);
      return res.status(404).json({ error: 'Comment not found.' });
    }

    let commentData = commentResult.rows[0];
    let likes = commentData.likes || [];

    if (likes.includes(uid)) {
      console.log(`Removing user ${uid} from likes for comment ${commentId}`);
      await pool.query(
        'UPDATE comments SET likes = array_remove(likes, $1) WHERE id = $2',
        [uid, commentId]
      );
    } else {
      console.log(`User ${uid} hasn't liked comment ${commentId}, no changes made`);
    }

    // Get updated comment
    const updatedResult = await pool.query('SELECT * FROM comments WHERE id = $1', [commentId]);
    const updatedData = updatedResult.rows[0];
    const updatedLikes = updatedData.likes || [];

    // Fetch usernames for users who liked this comment
    let likedBy = [];
    if (updatedLikes.length > 0) {
      const usersResult = await pool.query(
        'SELECT id, username FROM users WHERE id = ANY($1)',
        [updatedLikes]
      );
      likedBy = usersResult.rows.map(u => ({ id: u.id, username: u.username }));
    }

    const updatedComment = {
      id: updatedData.id,
      postId: updatedData.post_id,
      userId: updatedData.user_id,
      text: updatedData.text,
      username: updatedData.username,
      userRole: updatedData.user_role,
      likes: updatedLikes,
      likedBy,
      parentCommentId: updatedData.parent_comment_id,
      createdAt: updatedData.created_at ? new Date(updatedData.created_at).toISOString() : null
    };

    console.log(`Successfully processed unlike for comment ${commentId}, returning updated comment`);
    return res.json({ updatedComment });
  } catch (err) {
    console.error('Error in unlikeComment:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

const deleteComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const uid = req.user.uid;

    const commentResult = await pool.query('SELECT * FROM comments WHERE id = $1', [commentId]);

    if (commentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Comment not found.' });
    }

    const commentData = commentResult.rows[0];
    if (commentData.user_id !== uid && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden.' });
    }

    await pool.query('DELETE FROM comments WHERE id = $1', [commentId]);
    await deleteCache(generateCommentsCacheKey(postId));
    await deleteCacheByPattern('batchComments_*');

    return res.json({ message: 'Comment deleted successfully.' });
  } catch (err) {
    console.error('Error in deleteComment:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

const updateComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const { commentText } = req.body;
    const uid = req.user.uid;

    const commentResult = await pool.query('SELECT * FROM comments WHERE id = $1', [commentId]);

    if (commentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const commentData = commentResult.rows[0];
    if (commentData.user_id !== uid && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const updateResult = await pool.query(
      'UPDATE comments SET text = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [commentText, commentId]
    );
    const updatedComment = updateResult.rows[0];

    await deleteCache(generateCommentsCacheKey(postId));
    await deleteCacheByPattern('batchComments_*');

    return res.json({ updatedComment });
  } catch (err) {
    console.error('Error in updateComment:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Add this new function to track views
const incrementViews = async (req, res) => {
  try {
    const { postId } = req.params;
    console.log(`Incrementing view count for post ${postId}`);

    // Update the post's view count in PostgreSQL
    const result = await pool.query(
      'UPDATE posts SET views = views + 1 WHERE id = $1 RETURNING id',
      [postId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    console.log(`View count incremented for post ${postId}`);

    // Invalidate cache
    await deleteCache(generatePostCacheKey(postId));
    await deleteCacheByPattern('posts:*');

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Error incrementing view count:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

// Add a script to initialize view counts for posts that don't have them
const initializeViewCounts = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can run this operation' });
    }

    console.log('Initializing view counts for posts...');

    const result = await pool.query(
      'UPDATE posts SET views = 0 WHERE views IS NULL RETURNING id'
    );
    const updatedCount = result.rowCount;

    if (updatedCount > 0) {
      console.log(`Initialized view counts for ${updatedCount} posts`);
    } else {
      console.log('No posts needed view count initialization');
    }

    // Invalidate all post caches
    await deleteCacheByPattern('posts:*');

    return res.status(200).json({
      success: true,
      updatedCount,
      message: `Initialized view counts for ${updatedCount} posts`
    });
  } catch (err) {
    console.error('Error initializing view counts:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
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
};
