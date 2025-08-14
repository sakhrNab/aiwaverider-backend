const axios = require('axios');
const { request } = require('graphql-request');
const { getCache, setCache } = require('../utils/cache');

const VIDEO_CACHE_TTL = parseInt(process.env.VIDEO_CACHE_TTL) || 300;

/**
 * Extract video ID from various platform URLs
 */
const extractVideoId = {
  youtube: (url) => {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /youtube\.com\/v\/([^&\n?#]+)/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    throw new Error('Invalid YouTube URL');
  },

  tiktok: (url) => {
    const patterns = [
      /tiktok\.com\/@[^\/]+\/video\/(\d+)/,
      /tiktok\.com\/v\/(\d+)/,
      /vm\.tiktok\.com\/([A-Za-z0-9]+)/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    throw new Error('Invalid TikTok URL');
  },

  instagram: (url) => {
    const patterns = [
      /instagram\.com\/p\/([A-Za-z0-9_-]+)/,
      /instagram\.com\/reel\/([A-Za-z0-9_-]+)/,
      /instagram\.com\/tv\/([A-Za-z0-9_-]+)/
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    throw new Error('Invalid Instagram URL');
  }
};

/**
 * Generate embed URLs for each platform
 */
const generateEmbedUrl = {
  youtube: (videoId) => `https://www.youtube.com/embed/${videoId}`,
  tiktok: (videoId) => `https://www.tiktok.com/embed/v2/${videoId}`,
  instagram: (videoId) => `https://www.instagram.com/p/${videoId}/embed/`
};

/**
 * Fetch YouTube video metadata
 */
const fetchYouTubeMetadata = async (videoId) => {
  const cacheKey = `video_meta:youtube:${videoId}`;
  
  // Check cache first
  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`Cache hit for YouTube video: ${videoId}`);
    return cached;
  }

  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      throw new Error('YouTube API key not configured');
    }

    const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'snippet,statistics',
        id: videoId,
        key: apiKey
      }
    });

    if (!response.data.items || response.data.items.length === 0) {
      throw new Error('Video not found');
    }

    const video = response.data.items[0];
    const metadata = {
      platform: 'youtube',
      videoId,
      title: video.snippet.title,
      description: video.snippet.description || '',
      authorName: video.snippet.channelTitle,
      authorUser: video.snippet.channelTitle, // YouTube doesn't have separate username
      thumbnailUrl: video.snippet.thumbnails.maxres?.url || 
                   video.snippet.thumbnails.high?.url || 
                   video.snippet.thumbnails.medium?.url,
      views: parseInt(video.statistics.viewCount) || 0,
      likes: parseInt(video.statistics.likeCount) || 0,
      embedUrl: generateEmbedUrl.youtube(videoId)
    };

    // Cache the metadata (using optimized TTL)
    await setCache(cacheKey, metadata);
    console.log(`Cached YouTube metadata for video: ${videoId}`);
    
    return metadata;
  } catch (error) {
    console.error(`Error fetching YouTube metadata for ${videoId}:`, error.message);
    throw error;
  }
};

/**
 * Fetch TikTok video metadata using RapidAPI
 */
const fetchTikTokMetadata = async (videoId) => {
  const cacheKey = `video_meta:tiktok:${videoId}`;
  
  // Check cache first
  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`Cache hit for TikTok video: ${videoId}`);
    return cached;
  }

  try {
    const apiKey = process.env.TIKTOK_API_KEY;
    const apiHost = 'tiktok-api23.p.rapidapi.com';
    
    if (!apiKey) {
      throw new Error('TikTok RapidAPI key not configured. Please set TIKTOK_API_KEY environment variable.');
    }

    console.log(`Fetching TikTok metadata for video ID: ${videoId}`);

    // Using TikTok API via RapidAPI with correct endpoint
    const response = await axios.get(`https://${apiHost}/api/post/detail`, {
      params: {
        videoId: videoId
      },
      headers: {
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': apiHost
      }
    });

    if (!response.data || response.data.statusCode !== 0 || !response.data.itemInfo?.itemStruct) {
      throw new Error('Video not found or API error');
    }

    const video = response.data.itemInfo.itemStruct;
    const stats = video.stats || video.statsV2 || {};
    
    const metadata = {
      platform: 'tiktok',
      videoId,
      title: video.desc || 'TikTok Video',
      description: (video.contents && video.contents[0]?.desc) || video.desc || '',
      authorName: video.author?.nickname || video.author?.uniqueId || 'Unknown',
      authorUser: video.author?.uniqueId || 'Unknown',
      thumbnailUrl: video.video?.cover || video.video?.originCover || video.video?.dynamicCover || '',
      views: parseInt(stats.playCount?.toString().replace(/[^\d]/g, '')) || 0,
      likes: parseInt(stats.diggCount?.toString().replace(/[^\d]/g, '')) || 0,
      embedUrl: generateEmbedUrl.tiktok(videoId)
    };

    // Cache the metadata (using optimized TTL)
    await setCache(cacheKey, metadata);
    console.log(`Cached TikTok metadata for video: ${videoId}`);
    
    return metadata;
  } catch (error) {
    console.error(`Error fetching TikTok metadata for ${videoId}:`, error.message);
    
    // Handle specific API subscription errors
    if (error.response?.status === 403) {
      const errorData = error.response.data;
      if (errorData?.message?.includes('not subscribed')) {
        console.warn('TikTok API subscription issue - falling back to basic metadata');
        
        // Return basic metadata as fallback
        const fallbackMetadata = {
          platform: 'tiktok',
          videoId,
          title: 'TikTok Video',
          description: '',
          authorName: 'TikTok User',
          authorUser: 'tiktok_user',
          thumbnailUrl: '',
          views: 0,
          likes: 0,
          embedUrl: generateEmbedUrl.tiktok(videoId)
        };
        
        // Cache the fallback metadata for a shorter time
        await setCache(cacheKey, fallbackMetadata, 60); // 1 minute cache
        return fallbackMetadata;
      } else {
        throw new Error('TikTok API access forbidden. Please check your API key and subscription.');
      }
    }
    
    // Handle rate limiting
    if (error.response?.status === 429) {
      throw new Error('TikTok API rate limit exceeded. Please try again later.');
    }
    
    throw error;
  }
};

/**
 * Fetch Instagram video metadata - optional oEmbed support; fallback to basic
 */
const fetchInstagramMetadata = async (videoId, originalUrl) => {
  const cacheKey = `video_meta:instagram:${videoId}`;
  
  // Check cache first
  const cached = await getCache(cacheKey);
  if (cached) {
    console.log(`Cache hit for Instagram video: ${videoId}`);
    return cached;
  }

  try {
    console.log(`Creating metadata for Instagram video: ${videoId}`);
    
    // Try oEmbed if token provided
    const oembedToken = process.env.IG_OEMBED_TOKEN;
    if (oembedToken) {
      try {
        const oembedResp = await axios.get('https://graph.facebook.com/v10.0/instagram_oembed', {
          params: { url: originalUrl, access_token: oembedToken }
        });
        const meta = oembedResp.data || {};
        const metadata = {
          platform: 'instagram',
          videoId,
          title: meta.title || 'Instagram Post',
          description: meta.title || '',
          authorName: meta.author_name || 'Instagram User',
          authorUser: meta.author_name || 'instagram_user',
          thumbnailUrl: meta.thumbnail_url || '',
          views: 0,
          likes: 0,
          embedUrl: generateEmbedUrl.instagram(videoId)
        };
        await setCache(cacheKey, metadata);
        return metadata;
      } catch (e) {
        console.warn('Instagram oEmbed failed, falling back to basic parsing:', e.message);
      }
    }
    
    // Fallback path: parse username from URL
    let authorName = 'Instagram User';
    let authorUser = 'instagram_user';
    
    if (originalUrl) {
      const usernamePatterns = [
        /instagram\.com\/@([^\/]+)\//,
        /instagram\.com\/([^\/]+)\/p\//,
        /instagram\.com\/([^\/]+)\/reel\//,
        /instagram\.com\/([^\/]+)\/tv\//
      ];
      for (const pattern of usernamePatterns) {
        const match = originalUrl.match(pattern);
        if (match && match[1] && !['p', 'reel', 'tv', 'stories', 'explore'].includes(match[1].toLowerCase())) {
          const username = match[1];
          authorUser = username;
          authorName = username.charAt(0).toUpperCase() + username.slice(1);
          break;
        }
      }
    }
    
    const metadata = {
      platform: 'instagram',
      videoId,
      title: 'Instagram Post',
      description: '',
      authorName,
      authorUser,
      thumbnailUrl: '',
      views: 0,
      likes: 0,
      embedUrl: generateEmbedUrl.instagram(videoId),
      category: 'Tech'
    };

    await setCache(cacheKey, metadata);
    console.log(`Cached Instagram metadata for video: ${videoId} with author: ${authorName}`);
    
    return metadata;
  } catch (error) {
    console.error(`Error creating Instagram metadata for ${videoId}:`, error.message);
    throw error;
  }
};

/**
 * Main function to fetch metadata for any platform
 */
const fetchVideoMetadata = async (platform, originalUrl) => {
  try {
    const videoId = extractVideoId[platform](originalUrl);
    
    switch (platform) {
      case 'youtube':
        return await fetchYouTubeMetadata(videoId);
      case 'tiktok':
        return await fetchTikTokMetadata(videoId);
      case 'instagram':
        return await fetchInstagramMetadata(videoId, originalUrl);
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  } catch (error) {
    console.error(`Error fetching metadata for ${platform} URL ${originalUrl}:`, error.message);
    throw error;
  }
};

module.exports = {
  fetchVideoMetadata,
  extractVideoId,
  generateEmbedUrl,
  fetchYouTubeMetadata,
  fetchTikTokMetadata,
  fetchInstagramMetadata
}; 