/**
 * Update TikTok Embed URLs
 * 
 * This script updates all TikTok videos in the database to use the new /embed/v2/ format
 * without query parameters, replacing the old /player/v1/ format.
 * Usage: node scripts/update-tiktok-embed-urls.js
 */

require('dotenv').config();
const { db } = require('../config/firebase');

async function main() {
  console.log('Updating TikTok embed URLs...');
  
  try {
    // Get all TikTok videos
    const videosQuery = await db.collection('videos')
      .where('platform', '==', 'tiktok')
      .get();
    
    console.log(`Found ${videosQuery.size} TikTok videos`);
    
    let updated = 0;
    let skipped = 0;
    
    for (const doc of videosQuery.docs) {
      const video = doc.data();
      const videoId = doc.id;
      
      // Extract video ID from originalUrl
      const videoIdMatch = video.originalUrl?.match(/\/video\/(\d+)/);
      if (!videoIdMatch) {
        console.log(`⚠️  Skipping ${videoId}: Invalid URL format`);
        skipped++;
        continue;
      }
      
      const tiktokVideoId = videoIdMatch[1];
      const newEmbedUrl = `https://www.tiktok.com/embed/v2/${tiktokVideoId}`;
      
      // Check if update is needed
      const needsUpdate = !video.embedUrl || 
                          video.embedUrl.includes('/player/v1/') ||
                          video.embedUrl.includes('music_info') ||
                          video.embedUrl.includes('description') ||
                          video.embedUrl.includes('?') ||
                          video.embedUrl !== newEmbedUrl;
      
      if (needsUpdate) {
        await db.collection('videos').doc(videoId).update({
          embedUrl: newEmbedUrl
        });
        console.log(`✅ Updated ${videoId}: ${video.title?.substring(0, 50) || 'Untitled'}`);
        updated++;
      } else {
        skipped++;
      }
    }
    
    console.log('\n📊 Summary:');
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total: ${videosQuery.size}`);
    console.log('\n✅ Done!');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating embed URLs:', error);
    process.exit(1);
  }
}

main();




