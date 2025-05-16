/**
 * This script runs the cleanup of agent pricing data
 * Usage: node scripts/runCleanup.js
 */

require('dotenv').config();
const { db } = require('../config/firebase');

// Import and run the cleanup script
const { cleanupAgentPricing } = require('./cleanupAgentPricing');

console.log('Starting cleanup process...');

cleanupAgentPricing()
  .then(() => {
    console.log('Cleanup completed successfully.');
    process.exit(0);
  })
  .catch(error => {
    console.error('Cleanup failed:', error);
    process.exit(1);
  }); 