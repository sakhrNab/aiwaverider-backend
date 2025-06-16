const { db } = require('../config/firebase');
const { fetchVideoMetadata, extractVideoId } = require('../services/videoMetadata');
const { getCache, setCache, deleteCacheByPattern } = require('../utils/cache');

const VIDEO_CACHE_TTL = parseInt(process.env.VIDEO_CACHE_TTL) || 300;
const PAGE_SIZE = 50;

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

    console.log(`Successfully added ${platform} video with ID: ${docRef.id} by ${req.user.email}`);
    
    res.status(201).json({
      message: 'Video added successfully',
      video: savedVideo
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

    // Check cache first
    const cacheKey = `video_list:${platform}:page=${pageNum}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      console.log(`Cache hit for video list: ${platform}, page ${pageNum}`);
      return res.json(cached);
    }

    console.log(`Fetching ${platform} videos from database, page ${pageNum}`);

    // Get total count for pagination
    const totalQuery = await db.collection('videos')
      .where('platform', '==', platform)
      .get();
    const totalVideos = totalQuery.size;
    const totalPages = Math.ceil(totalVideos / PAGE_SIZE);

    // Get paginated videos using offset-based pagination (simplified)
    const offset = (pageNum - 1) * PAGE_SIZE;
    
    let videos = [];
    
    if (totalVideos > 0) {
      // Get all documents for this platform and slice them
      // Note: This is not the most efficient for large datasets, but works for now
      const allDocsQuery = await db.collection('videos')
        .where('platform', '==', platform)
        .orderBy('createdAt', 'desc')
        .get();
      
      const allDocs = allDocsQuery.docs.slice(offset, offset + PAGE_SIZE);
      
      // Process each video document
      for (const doc of allDocs) {
        const videoData = { id: doc.id, ...doc.data() };
        
        // Only try to refresh metadata for platforms that provide real-time stats
        // Instagram doesn't provide public stats, so skip the refresh
        if (platform !== 'instagram') {
          try {
            // Check if originalUrl exists before trying to extract video ID
            if (videoData.originalUrl) {
              const metaCacheKey = `video_meta:${platform}:${extractVideoId[platform](videoData.originalUrl)}`;
              const freshMeta = await getCache(metaCacheKey);
              
              if (freshMeta) {
                videoData.views = freshMeta.views;
                videoData.likes = freshMeta.likes;
              }
            } else {
              console.warn(`Video ${videoData.id} has undefined originalUrl, skipping metadata refresh`);
            }
          } catch (error) {
            console.warn(`Could not extract video ID for ${videoData.originalUrl}:`, error.message);
          }
        }

        // Convert Firestore timestamps to ISO strings
        if (videoData.createdAt && videoData.createdAt.toDate) {
          videoData.createdAt = videoData.createdAt.toDate().toISOString();
        }
        if (videoData.lastFetched && videoData.lastFetched.toDate) {
          videoData.lastFetched = videoData.lastFetched.toDate().toISOString();
        }

        videos.push(videoData);
      }
    }

    const response = {
      videos,
      currentPage: pageNum,
      totalPages,
      totalVideos,
      hasNextPage: pageNum < totalPages,
      hasPreviousPage: pageNum > 1
    };

    // Cache the response
    await setCache(cacheKey, response, VIDEO_CACHE_TTL);
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

module.exports = {
  addVideo,
  listVideos,
  refreshVideoStats
}; 