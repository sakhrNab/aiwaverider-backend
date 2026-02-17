/**
 * Clear Video Cache
 * 
 * This script clears the video list cache so new videos appear immediately.
 * Usage: node scripts/clear-video-cache.js [platform]
 */

require('dotenv').config();
const { deleteCacheByPattern } = require('../utils/cache');

async function main() {
  const platform = process.argv[2] || 'all';
  
  console.log('Clearing video cache...');
  console.log(`Platform: ${platform}`);
  
  try {
    if (platform === 'all') {
      await deleteCacheByPattern('video_list:*');
      console.log('✅ Cleared cache for all platforms');
    } else {
      await deleteCacheByPattern(`video_list:${platform}:*`);
      console.log(`✅ Cleared cache for ${platform}`);
    }
    
    console.log('Cache cleared successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing cache:', error);
    process.exit(1);
  }
}

main();




