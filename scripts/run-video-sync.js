/**
 * Run Video Channel Sync
 * 
 * This script runs the video channel sync manually.
 * Usage: node scripts/run-video-sync.js
 */

require('dotenv').config();
const { syncAllChannels } = require('../services/videoSync');

async function main() {
  console.log('='.repeat(60));
  console.log('Running Video Channel Sync');
  console.log('='.repeat(60));
  console.log('');

  try {
    const results = await syncAllChannels();
    
    console.log('');
    console.log('='.repeat(60));
    console.log('Sync Results:');
    console.log('='.repeat(60));
    console.log(`Duration: ${(results.duration / 1000).toFixed(2)}s`);
    console.log(`Total videos found: ${results.totalVideosFound}`);
    console.log(`Total videos added: ${results.totalVideosAdded}`);
    console.log(`Total videos updated: ${results.totalVideosUpdated}`);
    console.log(`Total errors: ${results.totalErrors}`);
    console.log('');
    
    if (results.platforms) {
      console.log('Platform Results:');
      for (const [platform, platformResults] of Object.entries(results.platforms)) {
        console.log(`  ${platform.toUpperCase()}:`);
        console.log(`    Found: ${platformResults.videosFound}`);
        console.log(`    Added: ${platformResults.videosAdded}`);
        console.log(`    Updated: ${platformResults.videosUpdated}`);
        if (platformResults.errors.length > 0) {
          console.log(`    Errors: ${platformResults.errors.length}`);
          platformResults.errors.forEach(err => {
            console.log(`      - ${err}`);
          });
        }
      }
    }
    
    if (results.totalErrors > 0) {
      console.log('');
      console.log('⚠️  Some errors occurred during sync. Check logs for details.');
      process.exit(1);
    } else {
      console.log('');
      console.log('✅ Sync completed successfully!');
      process.exit(0);
    }
  } catch (error) {
    console.error('');
    console.error('❌ Fatal error during sync:');
    console.error(error);
    process.exit(1);
  }
}

main();




