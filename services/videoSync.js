/**
 * Video Sync Service
 * Fetches videos from configured channels and syncs them to PostgreSQL
 */

const { pool } = require('../config/database');
const { fetchVideoMetadata } = require('./videoMetadata');
const { fetchYouTubeChannelVideos } = require('./channelFetchers/youtubeChannel');
const { fetchTikTokUserVideos } = require('./channelFetchers/tiktokChannel');
const { deleteCacheByPattern } = require('../utils/cache');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * Configuration for video sync
 */
const SYNC_CONFIG = {
  youtube: {
    enabled: process.env.YOUTUBE_SYNC_ENABLED !== 'false',
    channelId: process.env.YOUTUBE_CHANNEL_ID,
    username: process.env.YOUTUBE_USERNAME || 'AIWaveRider',
    apiKey: process.env.YOUTUBE_API_KEY,
    maxVideosPerSync: parseInt(process.env.YOUTUBE_MAX_VIDEOS) || 50,
    lookbackDays: parseInt(process.env.YOUTUBE_LOOKBACK_DAYS) || 1
  },
  tiktok: {
    enabled: process.env.TIKTOK_SYNC_ENABLED !== 'false',
    username: process.env.TIKTOK_USERNAME || 'ai.wave.rider',
    secUid: process.env.TIKTOK_SECUID,
    apiKey: process.env.TIKTOK_API_KEY,
    apiHost: process.env.TIKTOK_RAPIDAPI_HOST || 'tiktok-api23.p.rapidapi.com',
    maxVideosPerSync: parseInt(process.env.TIKTOK_MAX_VIDEOS) || 50,
    lookbackDays: parseInt(process.env.TIKTOK_LOOKBACK_DAYS) || 365
  }
};

/**
 * Check if video already exists in database
 */
async function videoExists(platform, originalUrl) {
  try {
    const { rows } = await pool.query(
      'SELECT 1 FROM videos WHERE platform = $1 AND original_url = $2 LIMIT 1',
      [platform, originalUrl]
    );
    return rows.length > 0;
  } catch (error) {
    logger.error(`Error checking if video exists: ${error.message}`);
    return false;
  }
}

/**
 * Add video to database
 */
async function addVideoToDatabase(videoData) {
  try {
    const id = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO videos (
        id, platform, original_url, embed_url, title, author_name,
        author_user, description, thumbnail_url, views, likes,
        comments_count, shares, added_by, added_by_uid, last_fetched
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
      RETURNING id`,
      [
        id,
        videoData.platform,
        videoData.originalUrl,
        videoData.embedUrl || null,
        videoData.title || null,
        videoData.authorName || null,
        videoData.authorUser || null,
        videoData.description || null,
        videoData.thumbnailUrl || null,
        videoData.views || 0,
        videoData.likes || 0,
        videoData.comments || 0,
        videoData.shares || 0,
        'system',
        null
      ]
    );
    logger.info(`Added video to database: ${rows[0].id} - ${videoData.title}`);
    return rows[0].id;
  } catch (error) {
    logger.error(`Error adding video to database: ${error.message}`);
    throw error;
  }
}

/**
 * Update existing video metadata
 */
async function updateVideoMetadata(videoId, updates) {
  try {
    const setClauses = ['last_fetched = NOW()'];
    const values = [];
    let paramIndex = 1;

    if (updates.views !== undefined) {
      setClauses.push(`views = $${paramIndex}`);
      values.push(updates.views);
      paramIndex++;
    }
    if (updates.likes !== undefined) {
      setClauses.push(`likes = $${paramIndex}`);
      values.push(updates.likes);
      paramIndex++;
    }
    if (updates.comments !== undefined) {
      setClauses.push(`comments_count = $${paramIndex}`);
      values.push(updates.comments);
      paramIndex++;
    }
    if (updates.shares !== undefined) {
      setClauses.push(`shares = $${paramIndex}`);
      values.push(updates.shares);
      paramIndex++;
    }
    if (updates.title !== undefined) {
      setClauses.push(`title = $${paramIndex}`);
      values.push(updates.title);
      paramIndex++;
    }
    if (updates.thumbnailUrl !== undefined) {
      setClauses.push(`thumbnail_url = $${paramIndex}`);
      values.push(updates.thumbnailUrl);
      paramIndex++;
    }
    if (updates.embedUrl !== undefined) {
      setClauses.push(`embed_url = $${paramIndex}`);
      values.push(updates.embedUrl);
      paramIndex++;
    }

    values.push(videoId);
    await pool.query(
      `UPDATE videos SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`,
      values
    );
    logger.info(`Updated video metadata: ${videoId}`);
  } catch (error) {
    logger.error(`Error updating video metadata: ${error.message}`);
    throw error;
  }
}

/**
 * Get existing video document by URL
 */
async function getExistingVideo(platform, originalUrl) {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM videos WHERE platform = $1 AND original_url = $2 LIMIT 1',
      [platform, originalUrl]
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
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
      comments: row.comments_count,
      shares: row.shares,
      lastFetched: row.last_fetched,
      createdAt: row.created_at
    };
  } catch (error) {
    logger.error(`Error getting existing video: ${error.message}`);
    return null;
  }
}

/**
 * Sync videos from YouTube channel
 */
async function syncYouTubeChannel() {
  const config = SYNC_CONFIG.youtube;
  const results = {
    platform: 'youtube',
    videosFound: 0,
    videosAdded: 0,
    videosUpdated: 0,
    errors: []
  };

  if (!config.enabled) {
    logger.info('YouTube sync is disabled');
    return results;
  }

  if (!config.apiKey) {
    logger.warn('YouTube API key not configured');
    results.errors.push('YouTube API key not configured');
    return results;
  }

  try {
    logger.info('Starting YouTube channel sync...');

    const channelVideos = await fetchYouTubeChannelVideos({
      channelId: config.channelId,
      username: config.username,
      apiKey: config.apiKey,
      maxResults: config.maxVideosPerSync,
      lookbackDays: config.lookbackDays
    });

    results.videosFound = channelVideos.length;
    logger.info(`Found ${channelVideos.length} videos from YouTube channel`);

    for (const channelVideo of channelVideos) {
      try {
        const exists = await videoExists('youtube', channelVideo.originalUrl);

        if (exists) {
          const existingVideo = await getExistingVideo('youtube', channelVideo.originalUrl);
          if (existingVideo) {
            const metadata = await fetchVideoMetadata('youtube', channelVideo.originalUrl);
            await updateVideoMetadata(existingVideo.id, {
              views: metadata.views,
              likes: metadata.likes,
              title: metadata.title,
              thumbnailUrl: metadata.thumbnailUrl
            });
            results.videosUpdated++;
          }
        } else {
          const metadata = await fetchVideoMetadata('youtube', channelVideo.originalUrl);
          await addVideoToDatabase({
            platform: 'youtube',
            originalUrl: channelVideo.originalUrl,
            embedUrl: metadata.embedUrl,
            title: metadata.title,
            authorName: metadata.authorName,
            authorUser: metadata.authorUser,
            thumbnailUrl: metadata.thumbnailUrl,
            views: metadata.views,
            likes: metadata.likes,
            description: channelVideo.description || ''
          });
          await deleteCacheByPattern(`video_list:youtube:*`);
          results.videosAdded++;
        }
      } catch (error) {
        logger.error(`Error processing YouTube video ${channelVideo.originalUrl}: ${error.message}`);
        results.errors.push(`Video ${channelVideo.videoId}: ${error.message}`);
      }
    }

    logger.info(`YouTube sync completed: ${results.videosAdded} added, ${results.videosUpdated} updated`);

    if (results.videosAdded > 0 || results.videosUpdated > 0) {
      await deleteCacheByPattern(`video_list:youtube:*`);
      logger.info('Invalidated YouTube video list cache');
    }

    return results;

  } catch (error) {
    logger.error(`YouTube sync failed: ${error.message}`);
    results.errors.push(error.message);
    return results;
  }
}

/**
 * Sync videos from TikTok user
 */
async function syncTikTokUser() {
  const config = SYNC_CONFIG.tiktok;
  const results = {
    platform: 'tiktok',
    videosFound: 0,
    videosAdded: 0,
    videosUpdated: 0,
    errors: []
  };

  if (!config.enabled) {
    logger.info('TikTok sync is disabled');
    return results;
  }

  const cleanUsername = config.username.replace(/^@/, '');

  if (!config.apiKey) {
    logger.warn('TikTok RapidAPI key not configured');
    results.errors.push('TikTok RapidAPI key not configured');
    return results;
  }

  try {
    logger.info('Starting TikTok user sync...');

    const userVideos = await fetchTikTokUserVideos({
      username: cleanUsername,
      secUid: config.secUid,
      apiKey: config.apiKey,
      apiHost: config.apiHost,
      maxResults: config.maxVideosPerSync,
      lookbackDays: config.lookbackDays
    });

    results.videosFound = userVideos.length;
    logger.info(`Found ${userVideos.length} videos from TikTok user`);

    for (const userVideo of userVideos) {
      try {
        const exists = await videoExists('tiktok', userVideo.originalUrl);

        if (exists) {
          const existingVideo = await getExistingVideo('tiktok', userVideo.originalUrl);
          if (existingVideo) {
            const videoIdMatch = userVideo.originalUrl.match(/\/video\/(\d+)/);
            const newEmbedUrl = videoIdMatch ? `https://www.tiktok.com/embed/v2/${videoIdMatch[1]}` : userVideo.embedUrl;

            const needsEmbedUpdate = !existingVideo.embedUrl ||
                                      existingVideo.embedUrl.includes('/player/v1/') ||
                                      existingVideo.embedUrl.includes('music_info') ||
                                      existingVideo.embedUrl.includes('description') ||
                                      existingVideo.embedUrl.includes('?');

            const updateData = {
              views: userVideo.views || existingVideo.views || 0,
              likes: userVideo.likes || existingVideo.likes || 0,
              comments: userVideo.comments || existingVideo.comments || 0,
              shares: userVideo.shares || existingVideo.shares || 0
            };

            if (needsEmbedUpdate && newEmbedUrl) {
              updateData.embedUrl = newEmbedUrl;
            }

            await updateVideoMetadata(existingVideo.id, updateData);
            results.videosUpdated++;
          }
        } else {
          const videoIdMatch = userVideo.originalUrl.match(/\/video\/(\d+)/);
          if (!videoIdMatch) {
            logger.warn(`Invalid TikTok URL format: ${userVideo.originalUrl}`);
            results.errors.push(`Invalid URL format: ${userVideo.originalUrl}`);
            continue;
          }

          const videoId = videoIdMatch[1];
          const embedUrl = `https://www.tiktok.com/embed/v2/${videoId}`;

          await addVideoToDatabase({
            platform: 'tiktok',
            originalUrl: userVideo.originalUrl,
            embedUrl: userVideo.embedUrl || embedUrl,
            title: userVideo.title || 'TikTok Video',
            authorName: userVideo.authorName || cleanUsername,
            authorUser: userVideo.authorUser || cleanUsername,
            thumbnailUrl: userVideo.thumbnailUrl || '',
            comments: userVideo.comments || 0,
            shares: userVideo.shares || 0,
            views: userVideo.views || 0,
            likes: userVideo.likes || 0,
            description: userVideo.description || ''
          });

          await deleteCacheByPattern(`video_list:tiktok:*`);
          results.videosAdded++;
        }
      } catch (error) {
        logger.error(`Error processing TikTok video ${userVideo.originalUrl}: ${error.message}`);
        results.errors.push(`Video ${userVideo.videoId}: ${error.message}`);
      }
    }

    logger.info(`TikTok sync completed: ${results.videosAdded} added, ${results.videosUpdated} updated`);

    if (results.videosAdded > 0 || results.videosUpdated > 0) {
      await deleteCacheByPattern(`video_list:tiktok:*`);
      logger.info('Invalidated TikTok video list cache');
    }

    return results;

  } catch (error) {
    logger.error(`TikTok sync failed: ${error.message}`);
    results.errors.push(error.message);
    return results;
  }
}

/**
 * Sync all channels
 */
async function syncAllChannels() {
  const startTime = Date.now();
  logger.info('='.repeat(60));
  logger.info('Starting video channel sync...');
  logger.info('='.repeat(60));

  const overallResults = {
    timestamp: new Date().toISOString(),
    duration: 0,
    platforms: {},
    totalVideosFound: 0,
    totalVideosAdded: 0,
    totalVideosUpdated: 0,
    totalErrors: 0
  };

  try {
    const youtubeResults = await syncYouTubeChannel();
    overallResults.platforms.youtube = youtubeResults;
    overallResults.totalVideosFound += youtubeResults.videosFound;
    overallResults.totalVideosAdded += youtubeResults.videosAdded;
    overallResults.totalVideosUpdated += youtubeResults.videosUpdated;
    overallResults.totalErrors += youtubeResults.errors.length;

    const tiktokResults = await syncTikTokUser();
    overallResults.platforms.tiktok = tiktokResults;
    overallResults.totalVideosFound += tiktokResults.videosFound;
    overallResults.totalVideosAdded += tiktokResults.videosAdded;
    overallResults.totalVideosUpdated += tiktokResults.videosUpdated;
    overallResults.totalErrors += tiktokResults.errors.length;

    overallResults.duration = Date.now() - startTime;

    logger.info('='.repeat(60));
    logger.info('Video channel sync completed');
    logger.info(`Duration: ${(overallResults.duration / 1000).toFixed(2)}s`);
    logger.info(`Total videos found: ${overallResults.totalVideosFound}`);
    logger.info(`Total videos added: ${overallResults.totalVideosAdded}`);
    logger.info(`Total videos updated: ${overallResults.totalVideosUpdated}`);
    logger.info(`Total errors: ${overallResults.totalErrors}`);
    logger.info('='.repeat(60));

    return overallResults;

  } catch (error) {
    logger.error(`Fatal error during video sync: ${error.message}`);
    overallResults.duration = Date.now() - startTime;
    overallResults.error = error.message;
    return overallResults;
  }
}

module.exports = {
  syncAllChannels,
  syncYouTubeChannel,
  syncTikTokUser
};
