/**
 * Video Sync Service
 * Fetches videos from configured channels and syncs them to Firestore
 */

const { db } = require('../config/firebase');
const { fetchVideoMetadata } = require('./videoMetadata');
const { fetchYouTubeChannelVideos } = require('./channelFetchers/youtubeChannel');
const { fetchTikTokUserVideos } = require('./channelFetchers/tiktokChannel');
const { deleteCacheByPattern } = require('../utils/cache');
const admin = require('firebase-admin');
const logger = require('../utils/logger');

/**
 * Configuration for video sync
 */
const SYNC_CONFIG = {
  youtube: {
    enabled: process.env.YOUTUBE_SYNC_ENABLED !== 'false',
    channelId: process.env.YOUTUBE_CHANNEL_ID,
    username: process.env.YOUTUBE_USERNAME || 'AIWaveRider', // Default username
    apiKey: process.env.YOUTUBE_API_KEY,
    maxVideosPerSync: parseInt(process.env.YOUTUBE_MAX_VIDEOS) || 50,
    lookbackDays: parseInt(process.env.YOUTUBE_LOOKBACK_DAYS) || 1
  },
  tiktok: {
    enabled: process.env.TIKTOK_SYNC_ENABLED !== 'false',
    username: process.env.TIKTOK_USERNAME || 'ai.wave.rider',
    secUid: process.env.TIKTOK_SECUID, // TikTok secUid (required for /api/user/posts)
    apiKey: process.env.TIKTOK_API_KEY, // RapidAPI key
    apiHost: process.env.TIKTOK_RAPIDAPI_HOST || 'tiktok-api23.p.rapidapi.com',
    maxVideosPerSync: parseInt(process.env.TIKTOK_MAX_VIDEOS) || 50,
    lookbackDays: parseInt(process.env.TIKTOK_LOOKBACK_DAYS) || 365 // Default to 1 year for monthly syncs (fetches all videos)
  }
};

/**
 * Check if video already exists in Firestore
 * @param {string} platform - Platform name
 * @param {string} originalUrl - Video URL
 * @returns {Promise<boolean>} True if video exists
 */
async function videoExists(platform, originalUrl) {
  try {
    const query = await db.collection('videos')
      .where('platform', '==', platform)
      .where('originalUrl', '==', originalUrl)
      .limit(1)
      .get();

    return !query.empty;
  } catch (error) {
    logger.error(`Error checking if video exists: ${error.message}`);
    return false;
  }
}

/**
 * Add video to Firestore
 * @param {Object} videoData - Video data
 * @returns {Promise<string>} Document ID
 */
async function addVideoToDatabase(videoData) {
  try {
    const videoRecord = {
      ...videoData,
      addedBy: 'system',
      addedByUid: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastFetched: admin.firestore.FieldValue.serverTimestamp(),
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      syncSource: 'scheduled'
    };

    const docRef = await db.collection('videos').add(videoRecord);
    logger.info(`Added video to database: ${docRef.id} - ${videoData.title}`);
    return docRef.id;
  } catch (error) {
    logger.error(`Error adding video to database: ${error.message}`);
    throw error;
  }
}

/**
 * Update existing video metadata
 * @param {string} videoId - Firestore document ID
 * @param {Object} updates - Fields to update
 */
async function updateVideoMetadata(videoId, updates) {
  try {
    await db.collection('videos').doc(videoId).update({
      ...updates,
      lastFetched: admin.firestore.FieldValue.serverTimestamp(),
      syncedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    logger.info(`Updated video metadata: ${videoId}`);
  } catch (error) {
    logger.error(`Error updating video metadata: ${error.message}`);
    throw error;
  }
}

/**
 * Get existing video document by URL
 * @param {string} platform - Platform name
 * @param {string} originalUrl - Video URL
 * @returns {Promise<Object|null>} Video document or null
 */
async function getExistingVideo(platform, originalUrl) {
  try {
    const query = await db.collection('videos')
      .where('platform', '==', platform)
      .where('originalUrl', '==', originalUrl)
      .limit(1)
      .get();

    if (query.empty) {
      return null;
    }

    const doc = query.docs[0];
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    logger.error(`Error getting existing video: ${error.message}`);
    return null;
  }
}

/**
 * Sync videos from YouTube channel
 * @returns {Promise<Object>} Sync results
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
    
    // Fetch videos from channel
    const channelVideos = await fetchYouTubeChannelVideos({
      channelId: config.channelId,
      username: config.username,
      apiKey: config.apiKey,
      maxResults: config.maxVideosPerSync,
      lookbackDays: config.lookbackDays
    });

    results.videosFound = channelVideos.length;
    logger.info(`Found ${channelVideos.length} videos from YouTube channel`);

    // Process each video
    for (const channelVideo of channelVideos) {
      try {
        // Check if video already exists
        const exists = await videoExists('youtube', channelVideo.originalUrl);
        
        if (exists) {
          // Update existing video metadata
          const existingVideo = await getExistingVideo('youtube', channelVideo.originalUrl);
          if (existingVideo) {
            // Fetch fresh metadata
            const metadata = await fetchVideoMetadata('youtube', channelVideo.originalUrl);
            
            await updateVideoMetadata(existingVideo.id, {
              views: metadata.views,
              likes: metadata.likes,
              title: metadata.title, // Update title in case it changed
              thumbnailUrl: metadata.thumbnailUrl
            });
            
            results.videosUpdated++;
          }
        } else {
          // Fetch full metadata and add new video
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
          
          // Invalidate cache for this platform
          await deleteCacheByPattern(`video_list:youtube:*`);
          
          results.videosAdded++;
        }
      } catch (error) {
        logger.error(`Error processing YouTube video ${channelVideo.originalUrl}: ${error.message}`);
        results.errors.push(`Video ${channelVideo.videoId}: ${error.message}`);
      }
    }

    logger.info(`YouTube sync completed: ${results.videosAdded} added, ${results.videosUpdated} updated`);
    
    // Invalidate cache after sync completes
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
 * @returns {Promise<Object>} Sync results
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

  // TikTok uses RapidAPI to fetch videos from channel
  const cleanUsername = config.username.replace(/^@/, '');

  if (!config.apiKey) {
    logger.warn('TikTok RapidAPI key not configured');
    results.errors.push('TikTok RapidAPI key not configured');
    return results;
  }

  try {
    logger.info('Starting TikTok user sync...');
    
    // Fetch videos from user using RapidAPI /api/user/posts endpoint
    const userVideos = await fetchTikTokUserVideos({
      username: cleanUsername,
      secUid: config.secUid, // TikTok secUid (required)
      apiKey: config.apiKey,
      apiHost: config.apiHost,
      maxResults: config.maxVideosPerSync,
      lookbackDays: config.lookbackDays
    });

    results.videosFound = userVideos.length;
    logger.info(`Found ${userVideos.length} videos from TikTok user`);

    // Process each video
    for (const userVideo of userVideos) {
      try {
        // Check if video already exists
        const exists = await videoExists('tiktok', userVideo.originalUrl);
        
         if (exists) {
           // Update TikTok video metadata (views, likes, comments, shares) for engagement sorting
           // Also update embedUrl to new format if it's still using old format
           const existingVideo = await getExistingVideo('tiktok', userVideo.originalUrl);
           if (existingVideo) {
             // Generate new embed URL (always use /embed/v2/ format without parameters)
             const videoIdMatch = userVideo.originalUrl.match(/\/video\/(\d+)/);
             const newEmbedUrl = videoIdMatch ? `https://www.tiktok.com/embed/v2/${videoIdMatch[1]}` : userVideo.embedUrl;
             
             // Check if embedUrl needs updating (old format or missing)
             const needsEmbedUpdate = !existingVideo.embedUrl || 
                                      existingVideo.embedUrl.includes('/player/v1/') ||
                                      existingVideo.embedUrl.includes('music_info') ||
                                      existingVideo.embedUrl.includes('description') ||
                                      existingVideo.embedUrl.includes('?');
             
             const updateData = {
               views: userVideo.views || existingVideo.views || 0,
               likes: userVideo.likes || existingVideo.likes || 0,
               comments: userVideo.comments || existingVideo.comments || 0,
               shares: userVideo.shares || existingVideo.shares || 0,
               lastFetched: new Date()
             };
             
             // Update embedUrl if it's using old format
             if (needsEmbedUpdate && newEmbedUrl) {
               updateData.embedUrl = newEmbedUrl;
             }
             
             await updateVideoMetadata(existingVideo.id, updateData);
             
             results.videosUpdated++;
           }
         } else {
          // For TikTok, we just need the embedded URL, not full metadata fetch
          // Extract video ID from URL to generate embed URL
          const videoIdMatch = userVideo.originalUrl.match(/\/video\/(\d+)/);
          if (!videoIdMatch) {
            logger.warn(`Invalid TikTok URL format: ${userVideo.originalUrl}`);
            results.errors.push(`Invalid URL format: ${userVideo.originalUrl}`);
            continue;
          }
          
          const videoId = videoIdMatch[1];
          // Use /embed/v2/ instead of /player/v1/ to avoid access denied errors
          const embedUrl = `https://www.tiktok.com/embed/v2/${videoId}`;
          
          // Add video with embedded URL (like YouTube)
          // RapidAPI provides metadata (title, description, views, likes, comments, shares) which we use
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
          
          // Invalidate cache for this platform
          await deleteCacheByPattern(`video_list:tiktok:*`);
          
          results.videosAdded++;
        }
      } catch (error) {
        logger.error(`Error processing TikTok video ${userVideo.originalUrl}: ${error.message}`);
        results.errors.push(`Video ${userVideo.videoId}: ${error.message}`);
      }
    }

    logger.info(`TikTok sync completed: ${results.videosAdded} added, ${results.videosUpdated} updated`);
    
    // Invalidate cache after sync completes
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
 * @returns {Promise<Object>} Overall sync results
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
    // Sync YouTube
    const youtubeResults = await syncYouTubeChannel();
    overallResults.platforms.youtube = youtubeResults;
    overallResults.totalVideosFound += youtubeResults.videosFound;
    overallResults.totalVideosAdded += youtubeResults.videosAdded;
    overallResults.totalVideosUpdated += youtubeResults.videosUpdated;
    overallResults.totalErrors += youtubeResults.errors.length;

    // Sync TikTok
    const tiktokResults = await syncTikTokUser();
    overallResults.platforms.tiktok = tiktokResults;
    overallResults.totalVideosFound += tiktokResults.videosFound;
    overallResults.totalVideosAdded += tiktokResults.videosAdded;
    overallResults.totalVideosUpdated += tiktokResults.videosUpdated;
    overallResults.totalErrors += tiktokResults.errors.length;

    // Calculate duration
    overallResults.duration = Date.now() - startTime;

    // Log summary
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

