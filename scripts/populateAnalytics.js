/**
 * One-time script to populate analytics from existing data
 * Run this once to initialize the analytics collection
 */

const { db, admin } = require('../config/firebase');
const analyticsService = require('../services/analyticsService');

async function populateAnalytics() {
  try {
    console.log('🚀 Starting analytics population from existing data...');
    
    // Initialize analytics service
    await analyticsService.initializeAnalytics();
    
    // Populate from existing data
    await analyticsService.populateFromExistingData();
    
    console.log('✅ Analytics population completed successfully!');
    console.log('📊 Analytics collection is now ready for ultra-fast queries');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error populating analytics:', error);
    process.exit(1);
  }
}

// Run the script
populateAnalytics();






