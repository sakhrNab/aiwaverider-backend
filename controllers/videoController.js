const crypto = require('crypto');
const { pool } = require('../config/database');
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
const MAX_VIDEO_CACHE_PER_PLATFORM = 5000; // Cap per-platform cache to prevent OOM

const normalizeVideoRow = (row) => {
  return {
    id: row.id,
    platform: row.platform,
    originalUrl: row.original_url,
    embedUrl: row.embed_url,
    title: row.title,
    authorName: row.author_name,
    authorUser: row.author_user,
    description: row.description,
    thumbnailUrl: row.thumbnail_url,
    views: row.views,
    likes: row.likes,
    commentsCount: row.comments_count,
    shares: row.shares,
    engagementScore: row.engagement_score,
    addedBy: row.added_by,
    addedByUid: row.added_by_uid,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    lastFetched: row.last_fetched ? new Date(row.last_fetched).toISOString() : null,
    category: row.category || 'general'
  };
};

const refreshVideosCache = async (platform) => {
  const platformKey = (platform || '').toLowerCase();
  if (!['youtube', 'tiktok', 'instagram'].includes(platformKey)) return false;
  try {
    const result = await pool.query(
      'SELECT * FROM videos WHERE platform = $1 ORDER BY created_at DESC LIMIT $2',
      [platformKey, MAX_VIDEO_CACHE_PER_PLATFORM]
    );

    let list = result.rows.map(normalizeVideoRow);

    // Enforce size limit per platform to prevent OOM
    if (list.length > MAX_VIDEO_CACHE_PER_PLATFORM) {
      console.warn(`Video cache for ${platformKey} truncated from ${list.length} to ${MAX_VIDEO_CACHE_PER_PLATFORM}`);
      list = list.slice(0, MAX_VIDEO_CACHE_PER_PLATFORM);
    }

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
    const existingResult = await pool.query(
      'SELECT id FROM videos WHERE platform = $1 AND original_url = $2 LIMIT 1',
      [platform, originalUrl]
    );

    if (existingResult.rows.length > 0) {
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

    const id = crypto.randomUUID();

    // Save to PostgreSQL
    const insertResult = await pool.query(
      `INSERT INTO videos (id, platform, original_url, embed_url, title, author_name, author_user, thumbnail_url, views, likes, description, added_by, added_by_uid, created_at, last_fetched)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW())
       RETURNING *`,
      [id, platform, originalUrl, metadata.embedUrl, metadata.title, metadata.authorName, metadata.authorUser, metadata.thumbnailUrl, metadata.views, metadata.likes, metadata.description || '', req.user.email, req.user.uid]
    );

    const savedVideo = normalizeVideoRow(insertResult.rows[0]);

    // Invalidate list cache for this platform
    await deleteCacheByPattern(`video_list:${platform}:*`);
    console.log(`Invalidated cache for platform: ${platform}`);

    // Refresh in-memory cache for this platform
    await refreshVideosCache(platform);

    console.log(`Successfully added ${platform} video with ID: ${id} by ${req.user.email}`);

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
    const { platform, page = 1, category } = req.query;

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

    const categoryFilter = category && category !== 'all' ? category : null;

    // Check Redis cache first
    const cacheKey = `video_list:${platform}:page=${pageNum}${categoryFilter ? `:cat=${categoryFilter}` : ''}`;
    const cached = await getCache(cacheKey);
    if (cached) {
      console.log(`Cache hit for video list: ${platform}, page ${pageNum}`);
      return res.json(cached);
    }

    console.log(`Fetching ${platform} videos (cache miss), page ${pageNum}`);

    // Ensure in-memory cache loaded for this platform
    await ensureVideosCacheLoaded(platform);

    const offset = (pageNum - 1) * PAGE_SIZE;

    let allVideosResult;
    if (categoryFilter) {
      allVideosResult = await pool.query(
        'SELECT * FROM videos WHERE platform = $1 AND category = $2 ORDER BY created_at DESC',
        [platform, categoryFilter]
      );
    } else if (platform === 'tiktok') {
      allVideosResult = await pool.query(
        'SELECT * FROM videos WHERE platform = $1',
        [platform]
      );
    } else {
      allVideosResult = await pool.query(
        'SELECT * FROM videos WHERE platform = $1 ORDER BY created_at DESC',
        [platform]
      );
    }

    const allVideos = [];
    for (const row of allVideosResult.rows) {
      const videoData = normalizeVideoRow(row);

      if (platform !== 'instagram') {
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

      if (platform === 'tiktok') {
        const views = parseInt(videoData.views) || 0;
        const likes = parseInt(videoData.likes) || 0;
        const comments = parseInt(videoData.commentsCount) || 0;
        const shares = parseInt(videoData.shares) || 0;
        videoData.engagementScore = likes + (views * 0.01) + (comments * 2) + (shares * 3);
      }

      allVideos.push(videoData);
    }

    if (platform === 'tiktok') {
      allVideos.sort((a, b) => (b.engagementScore || 0) - (a.engagementScore || 0));
    }

    const totalVideos = allVideos.length;
    const totalPages = Math.ceil(totalVideos / PAGE_SIZE);
    const videos = allVideos.slice(offset, offset + PAGE_SIZE);

    const response = {
      videos,
      currentPage: pageNum,
      totalPages,
      totalVideos,
      hasNextPage: pageNum < totalPages,
      hasPreviousPage: pageNum > 1
    };

    // Cache the response with platform-specific TTL
    // TikTok: 30 days (monthly sync), YouTube: 1 week (weekly sync), Instagram: 5 minutes (daily sync)
    let cacheTTL;
    if (platform === 'tiktok') {
      cacheTTL = 30 * 24 * 60 * 60; // 30 days
    } else if (platform === 'youtube') {
      cacheTTL = 7 * 24 * 60 * 60; // 1 week
    } else {
      cacheTTL = VIDEO_CACHE_TTL; // 5 minutes for Instagram (default)
    }
    await setCache(cacheKey, response, cacheTTL);
    console.log(`Cached video list for ${platform}, page ${pageNum} (TTL: ${cacheTTL}s)`);

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

    // Get video row
    const videoResult = await pool.query('SELECT * FROM videos WHERE id = $1', [id]);

    if (videoResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Video not found',
        message: 'Video with the specified ID does not exist'
      });
    }

    const videoData = videoResult.rows[0];
    const platform = videoData.platform;
    const originalUrl = videoData.original_url;

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

    // Update PostgreSQL with new stats
    await pool.query(
      'UPDATE videos SET views = $1, likes = $2, last_fetched = NOW() WHERE id = $3',
      [metadata.views, metadata.likes, id]
    );

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
        lastFetched: new Date().toISOString()
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

    const videoResult = await pool.query('SELECT * FROM videos WHERE id = $1', [id]);
    if (videoResult.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found', message: 'No video with this ID' });
    }

    const platform = videoResult.rows[0].platform;

    await pool.query('DELETE FROM videos WHERE id = $1', [id]);

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
