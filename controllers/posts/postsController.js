// backend/controllers/postsController.js

const sanitizeUtils = require('../../utils/sanitize');
const {
  uploadImageToStorage,
  deleteImageFromStorage
} = require('../../utils/storage');
const admin = require('firebase-admin');
const {
  getCache,
  setCache,
  deleteCache,
  deleteCacheByPattern,
  generatePostsCacheKey,
  generatePostCacheKey,
  generateCommentsCacheKey,
} = require('../../utils/cache');

const postsCollection = admin.firestore().collection('posts');
const commentsCollection = admin.firestore().collection('comments');
const usersCollection = admin.firestore().collection('users');

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

    // Get username from users collection
    const userDoc = await usersCollection.doc(user.uid).get();
    const username = userDoc.exists ? userDoc.data().username : 'Unknown User';

    // Sanitize inputs
    const sanitizedAdditionalHTML = sanitizeUtils.sanitizeContent(additionalHTML || '');
    const sanitizedGraphHTML = sanitizeUtils.sanitizeContent(graphHTML || '');

    // Add post to Firestore
    const newPostRef = await postsCollection.add({
      title,
      description,
      category,
      imageUrl,
      imageFilename,
      additionalHTML: sanitizedAdditionalHTML,
      graphHTML: sanitizedGraphHTML,
      createdBy: user.uid || null,
      createdByUsername: username,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const newPostDoc = await newPostRef.get();
    const newPost = { id: newPostRef.id, ...newPostDoc.data() };

    // Invalidate relevant caches
    await deleteCacheByPattern('posts:*');
    await setCache(generatePostCacheKey(newPostRef.id), newPost);

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

    // If not in cache, query Firestore
    let query = postsCollection.orderBy('createdAt', 'desc');
    
    if (category !== 'All') {
      query = query.where('category', '==', category);
    }
    
    if (startAfter) {
      const startAfterDoc = await postsCollection.doc(startAfter).get();
      if (startAfterDoc.exists) {
        query = query.startAfter(startAfterDoc);
      }
    }
    
    query = query.limit(parseInt(limit));
    
    const snapshot = await query.get();
    const posts = [];
    let lastDoc = null;

    snapshot.forEach((doc) => {
      posts.push({ id: doc.id, ...doc.data() });
      lastDoc = doc;
    });

    const response = {
      posts,
      lastPostId: lastDoc ? lastDoc.id : null,
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

    // If skipCache=true or not in cache, get from Firestore
    const postDoc = await postsCollection.doc(postId).get();
    
    if (!postDoc.exists) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const post = { id: postDoc.id, ...postDoc.data() };
    
    // Cache the post (unless skipCache is true)
    if (!skipCache) {
      const cacheKey = generatePostCacheKey(postId);
      await setCache(cacheKey, post);
      console.log(`Cached post ${postId}`);
    }

    console.log(`Serving fresh post ${postId} from Firestore, views: ${post.views || 0}`);
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
    const postDoc = await postsCollection.doc(postId).get();
    if (!postDoc.exists) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const postData = postDoc.data();
    if (postData.createdBy !== user.uid && user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized to update this post.' });
    }

    // Handle image updates if needed
    if (req.file) {
      // Delete old image if it exists
      if (postData.imageFilename) {
        await deleteImageFromStorage(postData.imageFilename);
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

    // Update the post
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await postsCollection.doc(postId).update(updates);

    // Get updated post and return it
    const updatedDoc = await postsCollection.doc(postId).get();
    const updatedPost = { id: updatedDoc.id, ...updatedDoc.data() };

    // Clear cache for this post
    await deleteCache(generatePostCacheKey(postId));
    await deleteCacheByPattern('posts:*'); // Clear all post lists

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
    const postDoc = await postsCollection.doc(postId).get();
    if (!postDoc.exists) {
      return res.status(404).json({ error: 'Post not found.' });
    }

    const postData = postDoc.data();
    if (postData.createdBy !== user.uid && user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized to delete this post.' });
    }

    // Delete image from Firebase Storage if it exists
    if (postData.imageFilename) {
      await deleteImageFromStorage(postData.imageFilename);
    }

    // Delete the post
    await postsCollection.doc(postId).delete();

    // Delete all comments for this post
    const commentsSnapshot = await commentsCollection
      .where('postId', '==', postId)
      .get();
    
    const batch = admin.firestore().batch();
    commentsSnapshot.docs.forEach((doc) => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    // Invalidate caches
    await deleteCacheByPattern('posts:*');
    await deleteCache(generatePostCacheKey(postId));
    await deleteCache(generateCommentsCacheKey(postId));

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

    const postRef = postsCollection.doc(postId);
    const postDoc = await postRef.get();

    if (!postDoc.exists) {
      console.log(`Post ${postId} not found`);
      return res.status(404).json({ error: 'Post not found' });
    }

    const post = postDoc.data();
    const likes = post.likes || [];
    const isLiked = likes.includes(userId);
    console.log(`Current like status for user ${userId} on post ${postId}: ${isLiked ? 'liked' : 'not liked'}`);

    // Toggle like
    try {
      if (isLiked) {
        console.log(`Removing like from user ${userId} on post ${postId}`);
        await postRef.update({
          likes: admin.firestore.FieldValue.arrayRemove(userId)
        });
      } else {
        console.log(`Adding like from user ${userId} on post ${postId}`);
        await postRef.update({
          likes: admin.firestore.FieldValue.arrayUnion(userId)
        });
      }
    } catch (updateError) {
      console.error(`Error updating like status: ${updateError.message}`);
      return res.status(500).json({ 
        error: 'Failed to update like status',
        details: updateError.message
      });
    }

    // Get updated post
    const updatedDoc = await postRef.get();
    const updatedPost = { 
      id: updatedDoc.id, 
      ...updatedDoc.data(),
      // Ensure createdAt is serialized properly
      createdAt: updatedDoc.data().createdAt ? updatedDoc.data().createdAt.toDate().toISOString() : null,
      updatedAt: updatedDoc.data().updatedAt ? updatedDoc.data().updatedAt.toDate().toISOString() : null
    };

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
      let query = postsCollection.orderBy('createdAt', 'desc').limit(limitNumber);
      if (cat !== 'All') {
        query = query.where('category', '==', cat);
      }

      const snapshot = await query.get();
      const postIds = snapshot.docs.map((doc) => doc.id);
      const postsForThisCategory = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
          comments: [],
        };
      });

      let allCommentsForThisCategory = [];
      if (postIds.length > 0) {
        const chunkSize = 10;
        const chunks = [];
        for (let i = 0; i < postIds.length; i += chunkSize) {
          chunks.push(postIds.slice(i, i + chunkSize));
        }
        const commentsPromises = chunks.map((chunk) =>
          commentsCollection
            .where('postId', 'in', chunk)
            .orderBy('createdAt', 'desc')
            .get()
        );
        const commentsSnapshots = await Promise.all(commentsPromises);

        allCommentsForThisCategory = commentsSnapshots.flatMap((snap) =>
          snap.docs.map((commentDoc) => {
            const cdata = commentDoc.data();
            return {
              id: commentDoc.id,
              ...cdata,
              createdAt: cdata.createdAt ? cdata.createdAt.toDate().toISOString() : null,
            };
          })
        );
      }

      const commentsByPostId = {};
      allCommentsForThisCategory.forEach((comment) => {
        if (!commentsByPostId[comment.postId]) {
          commentsByPostId[comment.postId] = [];
        }
        commentsByPostId[comment.postId].push(comment);
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
    
    // Fetch comments for all posts in batches to avoid Firestore limits
    const batchSize = 10; // Firestore "in" query supports up to 10 items
    const batches = [];
    
    for (let i = 0; i < postIds.length; i += batchSize) {
      batches.push(postIds.slice(i, i + batchSize));
    }
    
    console.log(`Processing ${batches.length} batches of comments`);
    
    const promises = batches.map(async (batchIds) => {
      try {
        const snapshot = await commentsCollection
          .where('postId', 'in', batchIds)
          .orderBy('createdAt', 'desc')
          .get();
          
        return snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt ? doc.data().createdAt.toDate().toISOString() : new Date().toISOString()
        }));
      } catch (error) {
        console.error(`Error fetching comments batch:`, error);
        // Return empty array for this batch to avoid failing the entire request
        return [];
      }
    });
    
    const allComments = (await Promise.all(promises)).flat();
    console.log(`Retrieved ${allComments.length} total comments`);
    
    // Group comments by postId
    for (const comment of allComments) {
      if (!results[comment.postId]) {
        results[comment.postId] = [];
      }
      results[comment.postId].push(comment);
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
    const snapshot = await commentsCollection
      .where('postId', '==', postId)
      .orderBy('createdAt', 'desc')
      .get();

    const allComments = [];
    const commentMap = new Map();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const likes = data.likes || [];
      let likedBy = [];
      
      if (likes.length > 0) {
        const userPromises = likes.map(userId =>
          usersCollection.doc(userId).get()
        );
        const userDocs = await Promise.all(userPromises);
        likedBy = userDocs
          .filter(doc => doc.exists)
          .map(doc => ({ id: doc.id, username: doc.data().username }));
      }

      const comment = {
        id: doc.id,
        postId: data.postId,
        userId: data.userId,
        text: data.text,
        username: data.username || 'Anonymous',
        userRole: data.userRole || 'user',
        likes: likes,
        likedBy: likedBy,
        parentCommentId: data.parentCommentId || null,
        replies: [],
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : new Date().toISOString()
      };

      commentMap.set(doc.id, comment);
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
    
    const newCommentRef = await commentsCollection.add({
      postId,
      text: commentText,
      parentCommentId: parentCommentId || null,
      userId: req.user.uid,
      username: req.user.username,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      likes: []
    });

    const newCommentDoc = await newCommentRef.get();
    const newComment = { id: newCommentRef.id, ...newCommentDoc.data() };

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
    
    const commentRef = commentsCollection.doc(commentId);
    const commentDoc = await commentRef.get();
    
    if (!commentDoc.exists) {
      console.log(`Comment ${commentId} not found`);
      return res.status(404).json({ error: 'Comment not found.' });
    }
    
    let commentData = commentDoc.data();
    let likes = commentData.likes || [];
    
    if (!likes.includes(uid)) {
      console.log(`Adding user ${uid} to likes for comment ${commentId}`);
      likes.push(uid);
      await commentRef.update({ likes });
      const updatedDoc = await commentRef.get();
      const updatedData = updatedDoc.data();

      const userPromises = likes.map(userId =>
        usersCollection.doc(userId).get()
      );
      const userDocs = await Promise.all(userPromises);
      const likedBy = userDocs
        .filter(doc => doc.exists)
        .map(doc => ({ id: doc.id, username: doc.data().username }));

      const updatedComment = {
        id: updatedDoc.id,
        ...updatedData,
        likes,
        likedBy,
        createdAt: updatedData.createdAt ? updatedData.createdAt.toDate().toISOString() : null
      };

      console.log(`Successfully liked comment ${commentId}, returning updated comment`);
      return res.json({ updatedComment });
    } else {
      console.log(`User ${uid} already liked comment ${commentId}, no changes made`);
      const userPromises = likes.map(userId =>
        usersCollection.doc(userId).get()
      );
      const userDocs = await Promise.all(userPromises);
      const likedBy = userDocs
        .filter(doc => doc.exists)
        .map(doc => ({ id: doc.id, username: doc.data().username }));

      const updatedComment = {
        id: commentDoc.id,
        ...commentData,
        likes,
        likedBy,
        createdAt: commentData.createdAt ? commentData.createdAt.toDate().toISOString() : null
      };

      return res.json({ updatedComment });
    }
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
    
    const commentRef = commentsCollection.doc(commentId);
    const commentDoc = await commentRef.get();
    
    if (!commentDoc.exists) {
      console.log(`Comment ${commentId} not found`);
      return res.status(404).json({ error: 'Comment not found.' });
    }
    
    let commentData = commentDoc.data();
    let likes = commentData.likes || [];
    
    if (likes.includes(uid)) {
      console.log(`Removing user ${uid} from likes for comment ${commentId}`);
      likes = likes.filter(id => id !== uid);
      await commentRef.update({ likes });
      
      const updatedDoc = await commentRef.get();
      const updatedData = updatedDoc.data();
      
      const userPromises = likes.map(userId =>
        usersCollection.doc(userId).get()
      );
      const userDocs = await Promise.all(userPromises);
      const likedBy = userDocs
        .filter(doc => doc.exists)
        .map(doc => ({ id: doc.id, username: doc.data().username }));
      
      const updatedComment = {
        id: updatedDoc.id,
        ...updatedData,
        likes,
        likedBy,
        createdAt: updatedData.createdAt ? updatedData.createdAt.toDate().toISOString() : null
      };
      
      console.log(`Successfully unliked comment ${commentId}, returning updated comment`);
      return res.json({ updatedComment });
    } else {
      console.log(`User ${uid} hasn't liked comment ${commentId}, no changes made`);
      const userPromises = likes.map(userId =>
        usersCollection.doc(userId).get()
      );
      const userDocs = await Promise.all(userPromises);
      const likedBy = userDocs
        .filter(doc => doc.exists)
        .map(doc => ({ id: doc.id, username: doc.data().username }));
      
      const updatedComment = {
        id: commentDoc.id,
        ...commentData,
        likes,
        likedBy,
        createdAt: commentData.createdAt ? commentData.createdAt.toDate().toISOString() : null
      };
      
      return res.json({ updatedComment });
    }
  } catch (err) {
    console.error('Error in unlikeComment:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
};

const deleteComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const uid = req.user.uid;
    const commentRef = commentsCollection.doc(commentId);
    const commentDoc = await commentRef.get();
    
    if (!commentDoc.exists) {
      return res.status(404).json({ error: 'Comment not found.' });
    }
    
    const commentData = commentDoc.data();
    if (commentData.userId !== uid && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    
    await commentRef.delete();
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
    const commentRef = commentsCollection.doc(commentId);
    const commentDoc = await commentRef.get();
    
    if (!commentDoc.exists) {
      return res.status(404).json({ error: 'Comment not found' });
    }
    
    const commentData = commentDoc.data();
    if (commentData.userId !== uid && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    await commentRef.update({
      text: commentText,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    const updatedDoc = await commentRef.get();
    const updatedComment = { id: updatedDoc.id, ...updatedDoc.data() };

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
    
    // Update the post's view count in Firestore
    const postRef = postsCollection.doc(postId);
    const postDoc = await postRef.get();
    
    if (!postDoc.exists) {
      return res.status(404).json({ error: 'Post not found' });
    }
    
    await postRef.update({
      views: admin.firestore.FieldValue.increment(1)
    });
    
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
    const snapshot = await postsCollection.get();
    const batch = admin.firestore().batch();
    let updatedCount = 0;
    
    for (const doc of snapshot.docs) {
      const post = doc.data();
      // Only update posts that don't have a views field
      if (post.views === undefined) {
        batch.update(doc.ref, { views: 0 });
        updatedCount++;
      }
    }
    
    if (updatedCount > 0) {
      await batch.commit();
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
