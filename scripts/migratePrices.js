/**
 * Migrate Agent Prices Script
 *
 * This script migrates existing agent pricing data to the new pricing model.
 * It reads all agents from the agents collection and creates corresponding
 * price documents in the prices collection.
 */

require('dotenv').config();
const { db } = require('../config/firebase');
const { validatePrice } = require('../models/priceModel');

// Collection references
const agentsCollection = db.collection('agents');
const pricesCollection = db.collection('prices');

const migratePrices = async () => {
  try {
    console.log('Starting migration of agent prices to new pricing model...');
    
    // Verify Firebase connection first
    try {
      await db.collection('_test_connection').doc('test').set({
        timestamp: new Date().toISOString()
      });
      await db.collection('_test_connection').doc('test').delete();
      console.log('✅ Firebase connection verified successfully!');
    } catch (error) {
      console.error('❌ Firebase connection failed!', error);
      process.exit(1);
    }
    
    // Get all agents
    const agentsSnapshot = await agentsCollection.get();
    
    if (agentsSnapshot.empty) {
      console.log('No agents found to migrate.');
      process.exit(0);
    }
    
    console.log(`Found ${agentsSnapshot.size} agents to process.`);
    
    // Create an array to store batch operations
    let batch = db.batch();
    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    // Process each agent
    for (let i = 0; i < agentsSnapshot.docs.length; i++) {
      const agentDoc = agentsSnapshot.docs[i];
      const agentId = agentDoc.id;
      const agentData = agentDoc.data();
      
      try {
        // Check if price already exists for this agent
        const existingPriceDoc = await pricesCollection.doc(agentId).get();
        
        if (existingPriceDoc.exists) {
          console.log(`Price already exists for agent ${agentId}, skipping...`);
          skippedCount++;
          continue;
        }
        
        // Extract pricing data based on format
        let priceData = {
          agentId: agentId,
          basePrice: 0,
          currency: 'USD',
          isFree: false,
          isSubscription: false
        };
        
        // Try to get price from priceDetails (new format)
        if (agentData.priceDetails) {
          priceData.basePrice = agentData.priceDetails.basePrice || 0;
          priceData.currency = agentData.priceDetails.currency || 'USD';
          
          // If there's a discounted price, create a discount
          if (agentData.priceDetails.discountedPrice !== undefined && 
              agentData.priceDetails.discountedPrice < agentData.priceDetails.basePrice) {
            const discountAmount = agentData.priceDetails.basePrice - agentData.priceDetails.discountedPrice;
            const discountPercentage = Math.round((discountAmount / agentData.priceDetails.basePrice) * 100);
            
            priceData.discount = {
              amount: discountAmount,
              percentage: discountPercentage,
              validFrom: new Date().toISOString(),
              validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
            };
          }
        } 
        // Try to get price from direct price field (old format)
        else if (agentData.price !== undefined) {
          // Handle different price formats
          if (typeof agentData.price === 'number') {
            priceData.basePrice = agentData.price;
          } else if (typeof agentData.price === 'string') {
            // Extract numeric part from price string (e.g., "$25" or "$25/month")
            const match = agentData.price.match(/\$?(\d+(\.\d+)?)/);
            if (match) {
              priceData.basePrice = parseFloat(match[1]);
            }
            
            // Check if it's a subscription
            if (agentData.price.includes('/month')) {
              priceData.isSubscription = true;
            }
          }
        }
        
        // Set free flag
        priceData.isFree = priceData.basePrice === 0 || agentData.isFree === true;
        priceData.isSubscription = priceData.isSubscription || agentData.isSubscription === true;
        
        // Add pricing tiers if agent has subscription tiers
        if (agentData.subscriptionTiers && Array.isArray(agentData.subscriptionTiers)) {
          priceData.pricingTiers = agentData.subscriptionTiers;
        }
        
        // Initialize price history
        priceData.priceHistory = [];
        
        // Add initial history entry if not free
        if (!priceData.isFree) {
          priceData.priceHistory.push({
            price: priceData.basePrice,
            currency: priceData.currency,
            timestamp: agentData.createdAt || new Date().toISOString(),
            reason: 'Initial price'
          });
        }
        
        // Set final price
        if (priceData.discount) {
          priceData.finalPrice = priceData.basePrice - priceData.discount.amount;
        } else {
          priceData.finalPrice = priceData.basePrice;
        }
        
        // Set updatedAt
        priceData.updatedAt = new Date().toISOString();
        
        // Validate price data
        const validPrice = validatePrice(priceData);
        
        // Add to batch
        const priceRef = pricesCollection.doc(agentId);
        batch.set(priceRef, validPrice);
        
        migratedCount++;
        
        // Commit batch every 500 operations (Firestore limit)
        if (migratedCount % 500 === 0) {
          await batch.commit();
          console.log(`Committed batch of ${migratedCount} price migrations.`);
          batch = db.batch();
        }
      } catch (error) {
        console.error(`Error processing agent ${agentId}:`, error);
        errorCount++;
      }
    }
    
    // Commit any remaining operations
    if (migratedCount % 500 > 0) {
      await batch.commit();
      console.log(`Committed final batch of ${migratedCount % 500} price migrations.`);
    }
    
    console.log('\n===== Migration Summary =====');
    console.log(`Total agents processed: ${agentsSnapshot.size}`);
    console.log(`Prices migrated: ${migratedCount}`);
    console.log(`Agents skipped (already had prices): ${skippedCount}`);
    console.log(`Errors encountered: ${errorCount}`);
    console.log('===========================');
    
    process.exit(0);
  } catch (error) {
    console.error('Error during price migration:', error);
    process.exit(1);
  }
};

// Run the migration
migratePrices(); 