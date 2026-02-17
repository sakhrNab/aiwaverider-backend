/**
 * TikTok Channel Fetcher
 * Fetches videos from a TikTok user using RapidAPI
 * 
 * Uses RapidAPI endpoint: /api/user/posts with secUid
 * Gets all videos from TikTok channel and creates embed URLs
 */

const axios = require('axios');
const { getCache, setCache } = require('../../utils/cache');

const CACHE_TTL = 300; // 5 minutes cache

/**
 * Get secUid from username (if needed)
 * Note: secUid is usually required, but we can try to get it from user info endpoint
 * @param {string} username - TikTok username
 * @param {string} apiKey - RapidAPI key
 * @param {string} apiHost - RapidAPI host
 * @returns {Promise<string>} secUid
 */
async function getSecUidFromUsername(username, apiKey, apiHost) {
  const cleanUsername = username.replace(/^@/, '');
  const cleanApiHost = apiHost.replace(/^https?:\/\//, '');
  
  const cacheKey = `tiktok_secuid:${cleanUsername}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Try to get user info to extract secUid
    // Note: This endpoint might not exist, so secUid might need to be provided manually
    const response = await axios.get(`https://${cleanApiHost}/api/user/info`, {
      params: {
        username: cleanUsername
      },
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': cleanApiHost
      },
      timeout: 10000,
      validateStatus: () => true
    });

    if (response.status === 200 && response.data?.userInfo?.user?.secUid) {
      const secUid = response.data.userInfo.user.secUid;
      await setCache(cacheKey, secUid, 86400 * 30); // Cache for 30 days
      return secUid;
    }

    throw new Error('Could not get secUid from API');
  } catch (error) {
    console.warn(`Could not get secUid for ${cleanUsername}: ${error.message}`);
    throw new Error(`secUid is required. Please set TIKTOK_SECUID environment variable or ensure user info endpoint works.`);
  }
}

/**
 * Fetch videos from TikTok user using RapidAPI /api/user/posts endpoint
 * @param {Object} config - Configuration object
 * @param {string} config.username - TikTok username (e.g., "ai.wave.rider")
 * @param {string} config.secUid - TikTok secUid (required for /api/user/posts)
 * @param {string} config.apiKey - RapidAPI key
 * @param {string} config.apiHost - RapidAPI host
 * @param {number} config.maxResults - Maximum number of videos to fetch (default: 50)
 * @param {number} config.lookbackDays - Number of days to look back (default: 1)
 * @returns {Promise<Array>} Array of video objects with URLs
 */
async function fetchTikTokUserVideos(config) {
  const {
    username,
    secUid,
    apiKey,
    apiHost = 'tiktok-api23.p.rapidapi.com',
    maxResults = 50,
    lookbackDays = 1
  } = config;

  if (!apiKey) {
    throw new Error('TikTok RapidAPI key is required');
  }

  if (!username) {
    throw new Error('TikTok username is required');
  }

  // Clean username and API host
  const cleanUsername = username.replace(/^@/, '');
  const cleanApiHost = apiHost.replace(/^https?:\/\//, '');

  try {
    console.log(`Fetching TikTok videos for user: ${cleanUsername} using RapidAPI`);

    // Get secUid if not provided
    let finalSecUid = secUid;
    if (!finalSecUid) {
      try {
        finalSecUid = await getSecUidFromUsername(cleanUsername, apiKey, cleanApiHost);
        console.log(`Retrieved secUid: ${finalSecUid.substring(0, 20)}...`);
      } catch (error) {
        // If we can't get secUid automatically, try making a call with cursor=0
        // and extract secUid from the first response
        console.log('Attempting to extract secUid from first API call...');
        try {
          // Make a test call - some APIs might work with username or return secUid in error
          // Actually, we need secUid to make the call, so this won't work
          throw new Error(`secUid is required. Set TIKTOK_SECUID environment variable. Run: node scripts/get-tiktok-secuid.js ${cleanUsername}`);
        } catch (innerError) {
          throw error; // Re-throw original error
        }
      }
    }

    // Fetch videos using /api/user/posts endpoint
    const videos = [];
    let cursor = 0;
    let hasMore = true;
    // For TikTok, we want to fetch all videos for initial sync
    // Only apply date filter if lookbackDays is explicitly set and reasonable
    const publishedAfter = lookbackDays > 0 && lookbackDays < 365 ? 
      new Date(Date.now() - (lookbackDays * 24 * 60 * 60 * 1000)) : 
      new Date(0); // If lookbackDays is 0 or >= 365, fetch all videos (date = epoch)

    while (hasMore && videos.length < maxResults) {
      try {
        const response = await axios.get(`https://${cleanApiHost}/api/user/posts`, {
          params: {
            secUid: finalSecUid,
            count: Math.min(35, maxResults - videos.length), // API supports up to 35 per request
            cursor: cursor
          },
          headers: {
            'X-RapidAPI-Key': apiKey,
            'X-RapidAPI-Host': cleanApiHost
          },
          timeout: 30000,
          validateStatus: () => true
        });

        if (response.status !== 200) {
          console.error(`RapidAPI error: ${response.status}`, response.data);
          break;
        }

        const data = response.data?.data || response.data;
        if (!data || !data.itemList || data.itemList.length === 0) {
          console.log('No more videos found');
          break;
        }

        // Process videos
        for (const item of data.itemList) {
          // Check date filter (only if lookbackDays is set and reasonable)
          // For initial sync (lookbackDays = 0 or >= 365), fetch all videos
          if (lookbackDays > 0 && lookbackDays < 365 && item.createTime) {
            const videoDate = new Date(item.createTime * 1000); // TikTok uses Unix timestamp
            if (videoDate < publishedAfter) {
              // Skip old videos (older than lookbackDays)
              continue;
            }
          }

          // Extract video data
          const videoId = item.id;
          const videoUrl = `https://www.tiktok.com/@${item.author?.uniqueId || cleanUsername}/video/${videoId}`;
          // Use /embed/v2/ format without any query parameters to avoid access denied errors
          const embedUrl = `https://www.tiktok.com/embed/v2/${videoId}`;

          videos.push({
            videoId: videoId,
            title: item.desc || 'TikTok Video',
            description: item.desc || '',
            publishedAt: item.createTime ? new Date(item.createTime * 1000).toISOString() : new Date().toISOString(),
            thumbnailUrl: item.video?.cover || item.video?.coverMedium || item.video?.coverThumb || '',
            authorName: item.author?.nickname || cleanUsername,
            authorUser: item.author?.uniqueId || cleanUsername,
            originalUrl: videoUrl,
            embedUrl: embedUrl,
            views: item.stats?.playCount || item.statsV2?.playCount || 0,
            likes: item.stats?.diggCount || item.statsV2?.diggCount || 0,
            comments: item.stats?.commentCount || item.statsV2?.commentCount || 0,
            shares: item.stats?.shareCount || item.statsV2?.shareCount || 0
          });

          if (videos.length >= maxResults) {
            break;
          }
        }

        // Check if there are more videos
        hasMore = data.extra?.hasMore || false;
        cursor = data.cursor || cursor + data.itemList.length;

        console.log(`Fetched ${videos.length} videos so far (cursor: ${cursor})`);

        // If no more videos or reached max, break
        if (!hasMore || videos.length >= maxResults) {
          break;
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Error fetching TikTok videos (cursor: ${cursor}):`, error.message);
        if (error.response) {
          console.error('API Error:', error.response.status, error.response.data);
        }
        break;
      }
    }

    console.log(`Fetched ${videos.length} videos from TikTok user ${cleanUsername}`);
    return videos;

  } catch (error) {
    console.error('Error fetching TikTok user videos:', error.message);
    if (error.response) {
      console.error('API Error:', error.response.status, error.response.data);
    }
    throw error;
  }
}

/**
 * Fetch TikTok video by URL
 * This works with the existing API endpoint
 */
async function fetchTikTokVideoByUrl(videoUrl, apiKey, apiHost = 'tiktok-api23.p.rapidapi.com') {
  try {
    // Extract video ID from URL
    const videoIdMatch = videoUrl.match(/\/video\/(\d+)/);
    if (!videoIdMatch) {
      throw new Error('Invalid TikTok video URL');
    }

    const videoId = videoIdMatch[1];
    
    // Clean API host (remove https:// if present)
    const cleanApiHost = apiHost.replace(/^https?:\/\//, '');
    
    const response = await axios.get(`https://${cleanApiHost}/api/post/detail`, {
      params: {
        videoId: videoId
      },
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': cleanApiHost
      },
      timeout: 10000
    });

    if (response.data && response.data.itemInfo?.itemStruct) {
      const video = response.data.itemInfo.itemStruct;
      return {
        videoId: video.id,
        title: video.desc || 'TikTok Video',
        description: video.desc || '',
        publishedAt: new Date(video.createTime * 1000).toISOString(),
        thumbnailUrl: video.video?.cover || '',
        authorName: video.author?.nickname || 'Unknown',
        authorUser: video.author?.uniqueId || 'Unknown',
        originalUrl: videoUrl,
        views: video.stats?.playCount || 0,
        likes: video.stats?.diggCount || 0
      };
    }

    throw new Error('Video not found');
  } catch (error) {
    console.error(`Error fetching TikTok video ${videoUrl}:`, error.message);
    throw error;
  }
}

module.exports = {
  fetchTikTokUserVideos,
  fetchTikTokVideoByUrl,
  getSecUidFromUsername
};
