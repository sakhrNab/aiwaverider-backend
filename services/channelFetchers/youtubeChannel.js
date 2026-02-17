/**
 * YouTube Channel Fetcher
 * Fetches videos from a YouTube channel using YouTube Data API v3
 */

const axios = require('axios');
const { getCache, setCache } = require('../../utils/cache');

const CACHE_TTL = 300; // 5 minutes cache for channel data

/**
 * Get channel ID from username/handle
 * @param {string} username - YouTube username (e.g., "AIWaveRider" or "@AIWaveRider")
 * @param {string} apiKey - YouTube API key
 * @returns {Promise<string>} Channel ID
 */
async function getChannelIdFromUsername(username, apiKey) {
  // Remove @ if present
  const cleanUsername = username.replace(/^@/, '');
  
  const cacheKey = `youtube_channel_id:${cleanUsername}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Method 1: Try searching by handle (modern approach - handles work better than forUsername)
    console.log(`Searching for YouTube channel: ${cleanUsername}`);
    const searchResponse = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        q: cleanUsername,
        type: 'channel',
        maxResults: 5,
        key: apiKey
      },
      timeout: 10000
    });

    if (searchResponse.data.items && searchResponse.data.items.length > 0) {
      // Try to find exact match by customUrl or title
      for (const item of searchResponse.data.items) {
        const channelTitle = item.snippet.title.toLowerCase();
        const customUrl = item.snippet.customUrl?.toLowerCase() || '';
        const searchTerm = cleanUsername.toLowerCase();
        
        // Check if it's an exact match
        if (channelTitle === searchTerm || 
            customUrl === searchTerm || 
            customUrl === `@${searchTerm}` ||
            channelTitle.includes(searchTerm)) {
          const channelId = item.id.channelId;
          console.log(`Found matching channel: ${item.snippet.title} (${channelId})`);
          await setCache(cacheKey, channelId, 86400); // Cache for 24 hours
          return channelId;
        }
      }
      
      // If no exact match, use the first result
      const channelId = searchResponse.data.items[0].id.channelId;
      console.log(`Using first search result: ${searchResponse.data.items[0].snippet.title} (${channelId})`);
      await setCache(cacheKey, channelId, 86400);
      return channelId;
    }

    // Method 2: Try forUsername (deprecated but might still work for some channels)
    try {
      const response = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
        params: {
          part: 'id',
          forUsername: cleanUsername,
          key: apiKey
        },
        timeout: 10000
      });

      if (response.data.items && response.data.items.length > 0) {
        const channelId = response.data.items[0].id;
        await setCache(cacheKey, channelId, 86400);
        return channelId;
      }
    } catch (forUsernameError) {
      // forUsername is deprecated, ignore this error
      console.log('forUsername method not available (deprecated)');
    }

    throw new Error(`Channel not found for username: ${cleanUsername}`);
  } catch (error) {
    if (error.response) {
      console.error('YouTube API error:', error.response.status, error.response.data);
    }
    throw new Error(`Failed to get channel ID: ${error.message}`);
  }
}

/**
 * Get uploads playlist ID from channel ID
 * @param {string} channelId - YouTube channel ID
 * @param {string} apiKey - YouTube API key
 * @returns {Promise<string>} Uploads playlist ID
 */
async function getUploadsPlaylistId(channelId, apiKey) {
  const cacheKey = `youtube_uploads_playlist:${channelId}`;
  const cached = await getCache(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
      params: {
        part: 'contentDetails',
        id: channelId,
        key: apiKey
      },
      timeout: 10000
    });

    if (response.data.items && response.data.items.length > 0) {
      const uploadsPlaylistId = response.data.items[0].contentDetails?.relatedPlaylists?.uploads;
      if (uploadsPlaylistId) {
        await setCache(cacheKey, uploadsPlaylistId, 86400); // Cache for 24 hours
        return uploadsPlaylistId;
      }
    }

    throw new Error('Uploads playlist not found');
  } catch (error) {
    throw new Error(`Failed to get uploads playlist: ${error.message}`);
  }
}

/**
 * Fetch videos from YouTube channel
 * @param {Object} config - Configuration object
 * @param {string} config.channelId - YouTube channel ID (optional, will resolve from username if not provided)
 * @param {string} config.username - YouTube username/handle (e.g., "AIWaveRider" or "@AIWaveRider")
 * @param {string} config.apiKey - YouTube API key
 * @param {number} config.maxResults - Maximum number of videos to fetch (default: 50)
 * @param {number} config.lookbackDays - Number of days to look back (default: 1)
 * @returns {Promise<Array>} Array of video objects
 */
async function fetchYouTubeChannelVideos(config) {
  const {
    channelId: providedChannelId,
    username,
    apiKey,
    maxResults = 50,
    lookbackDays = 1
  } = config;

  if (!apiKey) {
    throw new Error('YouTube API key is required');
  }

  if (!providedChannelId && !username) {
    throw new Error('Either channelId or username must be provided');
  }

  try {
    // Resolve channel ID if username provided
    let channelId = providedChannelId;
    if (!channelId && username) {
      console.log(`Resolving channel ID for username: ${username}`);
      channelId = await getChannelIdFromUsername(username, apiKey);
      console.log(`Resolved channel ID: ${channelId}`);
    }

    // Get uploads playlist ID
    console.log(`Getting uploads playlist for channel: ${channelId}`);
    const uploadsPlaylistId = await getUploadsPlaylistId(channelId, apiKey);
    console.log(`Uploads playlist ID: ${uploadsPlaylistId}`);

    // Calculate published after date
    const publishedAfter = new Date();
    publishedAfter.setDate(publishedAfter.getDate() - lookbackDays);
    const publishedAfterISO = publishedAfter.toISOString();

    // Fetch videos from uploads playlist
    const videos = [];
    let nextPageToken = null;
    let totalFetched = 0;

    do {
      const response = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
        params: {
          part: 'snippet,contentDetails',
          playlistId: uploadsPlaylistId,
          maxResults: Math.min(50, maxResults - totalFetched), // YouTube max is 50 per request
          pageToken: nextPageToken,
          key: apiKey
        },
        timeout: 15000
      });

      if (!response.data.items || response.data.items.length === 0) {
        break;
      }

      // Filter videos by published date
      for (const item of response.data.items) {
        const publishedAt = new Date(item.snippet.publishedAt);
        if (publishedAt >= publishedAfter) {
          videos.push({
            videoId: item.contentDetails.videoId,
            title: item.snippet.title,
            description: item.snippet.description,
            publishedAt: item.snippet.publishedAt,
            thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || '',
            channelTitle: item.snippet.videoOwnerChannelTitle || item.snippet.channelTitle,
            originalUrl: `https://www.youtube.com/watch?v=${item.contentDetails.videoId}`
          });
          totalFetched++;
        }
      }

      nextPageToken = response.data.nextPageToken;

      // Stop if we've reached max results
      if (totalFetched >= maxResults) {
        break;
      }

    } while (nextPageToken && totalFetched < maxResults);

    console.log(`Fetched ${videos.length} videos from YouTube channel ${channelId}`);
    return videos;

  } catch (error) {
    console.error('Error fetching YouTube channel videos:', error.message);
    if (error.response) {
      console.error('API Error:', error.response.status, error.response.data);
    }
    throw error;
  }
}

module.exports = {
  fetchYouTubeChannelVideos,
  getChannelIdFromUsername,
  getUploadsPlaylistId
};
