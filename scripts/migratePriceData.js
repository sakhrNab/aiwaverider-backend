/**
 * One-time script to migrate price data to the new consistent model
 * 
 * This script:
 * 1. Normalizes all agent price data
 * 2. Creates or updates price documents in the prices collection
 * 3. Records the current prices in the price_history collection
 * 
 * Usage:
 * node scripts/migratePriceData.js
 */

// Load environment variables from .env file if needed
require('dotenv').config();

const { db } = require('../config/firebase');
const { 
  normalizeAgentId, 
  createNormalizedPriceObject, 
  recordPriceHistory 
} = require('../controllers/agent/priceController');

// Collection references
const pricesCollection = db.collection('prices');
const agentsCollection = db.collection('agents');

// Track results for logging
const results = {
  totalAgents: 0,
  agentsUpdated: 0,
  pricesCreated: 0,
  pricesUpdated: 0,
  historyEntriesCreated: 0,
  errors: []
};

/**
 * Normalize price data for a single agent
 */
async function normalizeAgentPriceData(agent) {
  try {
    const agentId = agent.id;
    const normalizedAgentId = normalizeAgentId(agentId);
    
    console.log(`Processing agent: ${agentId}`);
    
    // Extract price data from agent document
    let priceData = {};
    
    // Check for legacy price formats
    if (agent.priceDetails) {
      priceData = {
        basePrice: agent.priceDetails.basePrice || 0,
        discountedPrice: agent.priceDetails.discountedPrice || agent.priceDetails.basePrice || 0,
        currency: agent.priceDetails.currency || 'USD',
        isFree: agent.isFree || false,
        isSubscription: agent.isSubscription || false
      };
    } else if (typeof agent.price !== 'undefined') {
      // Handle even older price format
      const price = agent.price;
      const isFree = price === 0 || price === '0' || price === 'Free';
      const isSubscription = typeof price === 'string' && price.includes('/month');
      
      // Parse price value if it's a string
      let numericPrice = 0;
      if (typeof price === 'string') {
        const match = price.match(/\$?(\d+(\.\d+)?)/);
        if (match) {
          numericPrice = parseFloat(match[1]);
        }
      } else if (typeof price === 'number') {
        numericPrice = price;
      }
      
      priceData = {
        basePrice: numericPrice,
        discountedPrice: numericPrice,
        currency: 'USD',
        isFree,
        isSubscription
      };
    } else {
      // No price data found, use defaults
      priceData = {
        basePrice: 0,
        discountedPrice: 0,
        currency: 'USD',
        isFree: true,
        isSubscription: false
      };
    }
    
    // Create a standardized price object
    const normalizedPrice = createNormalizedPriceObject(priceData, normalizedAgentId);
    
    // Check if price document already exists
    const priceDocRef = pricesCollection.doc(normalizedAgentId);
    const priceDoc = await priceDocRef.get();
    
    if (priceDoc.exists) {
      // Update existing price document
      await priceDocRef.update(normalizedPrice);
      results.pricesUpdated++;
      console.log(`Updated price document for ${normalizedAgentId}`);
    } else {
      // Create new price document
      await priceDocRef.set(normalizedPrice);
      results.pricesCreated++;
      console.log(`Created new price document for ${normalizedAgentId}`);
    }
    
    // Also check for any legacy price documents using different ID formats
    const legacyPriceFormats = [
      `price_${normalizedAgentId}`, // Old format from combinedUpdate function
      `price-${normalizedAgentId}`, // Another possible variation
      normalizedAgentId.replace('agent-', 'price-') // Yet another variation
    ];
    
    // Check and migrate any legacy price documents
    for (const legacyId of legacyPriceFormats) {
      const legacyDocRef = pricesCollection.doc(legacyId);
      const legacyDoc = await legacyDocRef.get();
      
      if (legacyDoc.exists) {
        console.log(`Found legacy price document with ID: ${legacyId}`);
        
        // Copy data to the new standardized document if needed
        if (!priceDoc.exists) {
          const legacyData = legacyDoc.data();
          await priceDocRef.set({
            ...normalizedPrice,
            ...legacyData,
            updatedAt: new Date().toISOString()
          });
          results.pricesCreated++;
          console.log(`Migrated legacy price document ${legacyId} to ${normalizedAgentId}`);
        }
        
        // Delete the legacy document
        await legacyDocRef.delete();
        console.log(`Deleted legacy price document: ${legacyId}`);
      }
    }
    
    // Record price history entry
    const historyId = await recordPriceHistory(
      normalizedPrice, 
      normalizedAgentId, 
      'system', 
      'migration'
    );
    results.historyEntriesCreated++;
    console.log(`Created price history entry: ${historyId}`);
    
    // Update agent document with normalized price data
    const agentUpdateData = {
      priceDetails: {
        basePrice: normalizedPrice.basePrice,
        discountedPrice: normalizedPrice.discountedPrice,
        currency: normalizedPrice.currency
      },
      // Keep legacy fields for backward compatibility
      price: normalizedPrice.discountedPrice,
      finalPrice: normalizedPrice.discountedPrice,
      basePrice: normalizedPrice.basePrice,
      isFree: normalizedPrice.isFree,
      updatedAt: new Date().toISOString()
    };
    
    await agentsCollection.doc(agentId).update(agentUpdateData);
    results.agentsUpdated++;
    console.log(`Updated agent document: ${agentId}`);
    
    return true;
  } catch (error) {
    console.error(`Error processing agent ${agent.id}:`, error);
    results.errors.push({ agentId: agent.id, error: error.message });
    return false;
  }
}

/**
 * Main migration function
 */
async function runMigration() {
  try {
    console.log('Starting price data migration...');
    
    // Get all agents
    const agentsSnapshot = await agentsCollection.get();
    results.totalAgents = agentsSnapshot.size;
    
    console.log(`Found ${results.totalAgents} agents to process`);
    
    // Process each agent
    const migrationPromises = agentsSnapshot.docs.map(async (doc) => {
      const agent = { 
        id: doc.id, 
        ...doc.data() 
      };
      return normalizeAgentPriceData(agent);
    });
    
    await Promise.all(migrationPromises);
    
    // Log results
    console.log('\nMigration completed:');
    console.log(`- Total agents processed: ${results.totalAgents}`);
    console.log(`- Agents updated: ${results.agentsUpdated}`);
    console.log(`- Price documents created: ${results.pricesCreated}`);
    console.log(`- Price documents updated: ${results.pricesUpdated}`);
    console.log(`- History entries created: ${results.historyEntriesCreated}`);
    
    if (results.errors.length > 0) {
      console.log(`\nEncountered ${results.errors.length} errors:`);
      results.errors.forEach((err, i) => {
        console.log(`${i+1}. Agent ${err.agentId}: ${err.error}`);
      });
    }
    
    console.log('\nPrice data migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Fatal error during migration:', error);
    process.exit(1);
  }
}

// Run the migration
runMigration(); 