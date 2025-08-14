const { db } = require('../config/firebase');
const { fetchVideoMetadata, extractVideoId } = require('../services/videoMetadata');
const { getCache, setCache, deleteCacheByPattern } = require('../utils/cache');

const VIDEO_CACHE_TTL = parseInt(process.env.VIDEO_CACHE_TTL) || 300;
const PAGE_SIZE = 50;

// ==========================================
// IN-MEMORY CACHE FOR VIDEOS (by platform)
// ==========================================
let videosCacheByPlatform = {
  youtube: [],
  tiktok: [],
  instagram: []
};
let videosCacheLastUpdated = {
  youtube: null,
  tiktok: null,
  instagram: null
};
const VIDEO_CACHE_REFRESH_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

const normalizeVideoDoc = (doc) => {
  const data = doc.data();
  const normalized = {
    id: doc.id,
    ...data
  };
  // Normalize timestamps to ISO strings for consistent transport
  if (normalized.createdAt && normalized.createdAt.toDate) {
    normalized.createdAt = normalized.createdAt.toDate().toISOString();
  }
  if (normalized.lastFetched && normalized.lastFetched.toDate) {
    normalized.lastFetched = normalized.lastFetched.toDate().toISOString();
  }
  return normalized;
};

const refreshVideosCache = async (platform) => {
  const platformKey = (platform || '').toLowerCase();
  if (!['youtube', 'tiktok', 'instagram'].includes(platformKey)) return false;
  try {
    const snapshot = await db
      .collection('videos')
      .where('platform', '==', platformKey)
      .orderBy('createdAt', 'desc')
      .get();

    const list = [];
    snapshot.forEach((doc) => list.push(normalizeVideoDoc(doc)));

    videosCacheByPlatform[platformKey] = list;
    videosCacheLastUpdated[platformKey] = new Date();
    return true;
  } catch (e) {
    console.error('Error refreshing videos cache:', e);
    return false;
  }
};

const ensureVideosCacheLoaded = async (platform) => {
  const platformKey = (platform || '').toLowerCase();
  if (!['youtube', 'tiktok', 'instagram'].includes(platformKey)) return false;
  const last = videosCacheLastUpdated[platformKey];
  const needsRefresh = !last || (Date.now() - new Date(last).getTime() > VIDEO_CACHE_REFRESH_INTERVAL);
  if (!videosCacheByPlatform[platformKey] || needsRefresh) {
    return await refreshVideosCache(platformKey);
  }
  return true;
};

/**
 * Add a new video (Admin only)
 * POST /api/videos
 */
const addVideo = async (req, res) => {
  try {
    const { platform, originalUrl } = req.body;

    // Validate required fields
    if (!platform || !originalUrl) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'platform and originalUrl are required'
      });
    }

    // Validate platform
    const validPlatforms = ['youtube', 'tiktok', 'instagram'];
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({
        error: 'Invalid platform',
        message: `Platform must be one of: ${validPlatforms.join(', ')}`
      });
    }

    console.log(`Adding ${platform} video: ${originalUrl} by ${req.user.email}`);

    // Extract video ID to validate URL format
    let videoId;
    try {
      videoId = extractVideoId[platform](originalUrl);
    } catch (error) {
      return res.status(400).json({
        error: 'Invalid URL format',
        message: error.message
      });
    }

    // Check if video already exists
    const existingVideoQuery = await db.collection('videos')
      .where('platform', '==', platform)
      .where('originalUrl', '==', originalUrl)
      .limit(1)
      .get();

    if (!existingVideoQuery.empty) {
      return res.status(409).json({
        error: 'Video already exists',
        message: 'This video has already been added to the gallery'
      });
    }

    // Fetch metadata from the platform
    let metadata;
    try {
      metadata = await fetchVideoMetadata(platform, originalUrl);
    } catch (error) {
      console.error(`Failed to fetch metadata for ${platform} video:`, error);
      return res.status(400).json({
        error: 'Failed to fetch video metadata',
        message: error.message
      });
    }

    // Create video record
    const videoRecord = {
      platform,
      originalUrl,
      embedUrl: metadata.embedUrl,
      title: metadata.title,
      authorName: metadata.authorName,
      authorUser: metadata.authorUser,
      thumbnailUrl: metadata.thumbnailUrl,
      views: metadata.views,
      likes: metadata.likes,
      description: metadata.description || '',
      addedBy: req.user.email, // Use authenticated user's email
      addedByUid: req.user.uid, // Also store the user ID
      createdAt: new Date(),
      lastFetched: new Date()
    };

    // Save to Firestore
    const docRef = await db.collection('videos').add(videoRecord);
    const savedVideo = { id: docRef.id, ...videoRecord };

    // Invalidate list cache for this platform
    await deleteCacheByPattern(`video_list:${platform}:*`);
    console.log(`Invalidated cache for platform: ${platform}`);

    // Refresh in-memory cache for this platform
    await refreshVideosCache(platform);

    console.log(`Successfully added ${platform} video with ID: ${docRef.id} by ${req.user.email}`);
    
    res.status(201).json({
      message: 'Video added successfully',
      video: { ...savedVideo, id: docRef.id }
    });

  } catch (error) {
    console.error('Error adding video:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to add video'
    });
  }
};

/**
 * List videos with pagination and caching
 * GET /api/videos?platform=youtube&page=1
 */
const listVideos = async (req, res) => {
  try {
    const { platform, page = 1 } = req.query;

    // Validate platform parameter
    if (!platform) {
      return res.status(400).json({
        error: 'Missing platform parameter',
        message: 'platform query parameter is required'
      });
    }

    const validPlatforms = ['youtube', 'tiktok', 'instagram'];
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({
        error: 'Invalid platform',
        message: `Platform must be one of: ${validPlatforms.join(', ')}`
      });
    }

    const pageNum = parseInt(page);
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        error: 'Invalid page parameter',
        message: 'page must be a positive integer'
      });
    }

    // Check Redis cache first
    const cacheKey = `video_list:${platform}:page=${pageNum}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      console.log(`Cache hit for video list: ${platform}, page ${pageNum}`);
      return res.json(cached);
    }

    console.log(`Fetching ${platform} videos (cache miss), page ${pageNum}`);

    // Ensure in-memory cache loaded for this platform
    await ensureVideosCacheLoaded(platform);

    // Compute totals from in-memory cache
    const allForPlatform = videosCacheByPlatform[platform] || [];
    const totalVideos = allForPlatform.length;
    const totalPages = Math.ceil(totalVideos / PAGE_SIZE);

    // Paginate from in-memory cache
    const offset = (pageNum - 1) * PAGE_SIZE;
    const paginated = allForPlatform.slice(offset, offset + PAGE_SIZE).map((v) => ({ ...v }));

    // Optionally refresh dynamic stats (views/likes) from meta cache if present
    if (totalVideos > 0 && platform !== 'instagram') {
      for (const videoData of paginated) {
        try {
          if (videoData.originalUrl) {
            const metaCacheKey = `video_meta:${platform}:${extractVideoId[platform](videoData.originalUrl)}`;
            const freshMeta = await getCache(metaCacheKey);
            if (freshMeta) {
              videoData.views = freshMeta.views;
              videoData.likes = freshMeta.likes;
            }
          }
        } catch (error) {
          console.warn(`Could not extract video ID for ${videoData.originalUrl}:`, error.message);
        }
      }
    }

    const response = {
      videos: paginated,
      currentPage: pageNum,
      totalPages,
      totalVideos,
      hasNextPage: pageNum < totalPages,
      hasPreviousPage: pageNum > 1
    };

    // Cache the response (using optimized TTL)
    await setCache(cacheKey, response);
    console.log(`Cached video list for ${platform}, page ${pageNum}`);

    res.json(response);

  } catch (error) {
    console.error('Error listing videos:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to fetch videos'
    });
  }
};

/**
 * Refresh video stats (Admin only)
 * PUT /api/videos/:id/refresh
 */
const refreshVideoStats = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        error: 'Missing video ID',
        message: 'Video ID is required'
      });
    }

    console.log(`Refreshing stats for video: ${id}`);

    // Get video document
    const videoDoc = await db.collection('videos').doc(id).get();
    
    if (!videoDoc.exists) {
      return res.status(404).json({
        error: 'Video not found',
        message: 'Video with the specified ID does not exist'
      });
    }

    const videoData = videoDoc.data();
    const { platform, originalUrl } = videoData;

    // Fetch fresh metadata
    let metadata;
    try {
      metadata = await fetchVideoMetadata(platform, originalUrl);
    } catch (error) {
      console.error(`Failed to refresh metadata for video ${id}:`, error);
      return res.status(400).json({
        error: 'Failed to refresh video metadata',
        message: error.message
      });
    }

    // Update Firestore with new stats
    const updateData = {
      views: metadata.views,
      likes: metadata.likes,
      lastFetched: new Date()
    };

    await db.collection('videos').doc(id).update(updateData);

    // Invalidate list cache for this platform
    await deleteCacheByPattern(`video_list:${platform}:*`);
    console.log(`Invalidated cache for platform: ${platform} after refresh`);

    // Refresh in-memory cache for this platform to reflect new stats
    await refreshVideosCache(platform);

    console.log(`Successfully refreshed stats for video ${id}: ${metadata.views} views, ${metadata.likes} likes`);

    res.json({
      message: 'Video stats refreshed successfully',
      videoId: id,
      stats: {
        views: metadata.views,
        likes: metadata.likes,
        lastFetched: updateData.lastFetched.toISOString()
      }
    });

  } catch (error) {
    console.error('Error refreshing video stats:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to refresh video stats'
    });
  }
};

/**
 * Delete a video (Admin only)
 * DELETE /api/videos/:id
 */
const deleteVideo = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Missing video ID', message: 'Video ID is required' });
    }

    const docRef = db.collection('videos').doc(id);
    const docSnap = await docRef.get();
    if (!docSnap.exists) {
      return res.status(404).json({ error: 'Video not found', message: 'No video with this ID' });
    }

    const data = docSnap.data();
    const platform = data.platform;

    await docRef.delete();

    // Invalidate caches related to this platform
    await deleteCacheByPattern(`video_list:${platform}:*`);

    // Refresh in-memory cache for this platform
    await refreshVideosCache(platform);

    return res.json({ success: true, message: 'Video deleted', id });
  } catch (error) {
    console.error('Error deleting video:', error);
    return res.status(500).json({ error: 'Internal server error', message: 'Failed to delete video' });
  }
};

module.exports = {
  addVideo,
  listVideos,
  refreshVideoStats,
  deleteVideo
}; 