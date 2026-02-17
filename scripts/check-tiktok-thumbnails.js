const { db } = require('../config/firebase');
require('dotenv').config();

(async () => {
  try {
    console.log('\n=== Checking TikTok Videos in Database ===\n');
    
    const videos = await db.collection('videos')
      .where('platform', '==', 'tiktok')
      .limit(10)
      .get();
    
    if (videos.empty) {
      console.log('No TikTok videos found in database.');
      process.exit(0);
    }
    
    console.log(`Found ${videos.size} TikTok videos:\n`);
    
    videos.docs.forEach((doc, idx) => {
      const v = doc.data();
      console.log(`Video ${idx + 1}:`);
      console.log('  ID:', doc.id);
      console.log('  Title:', (v.title || 'N/A').substring(0, 60));
      console.log('  thumbnailUrl:', v.thumbnailUrl || '❌ MISSING');
      console.log('  thumbnailUrl exists:', !!v.thumbnailUrl);
      console.log('  thumbnailUrl length:', v.thumbnailUrl?.length || 0);
      if (v.thumbnailUrl) {
        console.log('  thumbnailUrl preview:', v.thumbnailUrl.substring(0, 100));
      }
      console.log('  originalUrl:', v.originalUrl || 'N/A');
      console.log('---');
    });
    
    // Check how many have thumbnails
    const withThumbnails = videos.docs.filter(doc => {
      const v = doc.data();
      return v.thumbnailUrl && v.thumbnailUrl.trim() !== '';
    });
    
    console.log(`\nSummary:`);
    console.log(`  Total videos checked: ${videos.size}`);
    console.log(`  Videos with thumbnails: ${withThumbnails.length}`);
    console.log(`  Videos without thumbnails: ${videos.size - withThumbnails.length}`);
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})();




