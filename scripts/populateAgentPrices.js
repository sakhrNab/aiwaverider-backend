/**
 * Agent Price Population Script
 * =============================
 * 
 * This script randomly selects 400 agents with complexity (node) > 15
 * and assigns them random prices between $30-$70.
 * 
 * Usage: node populateAgentPrices.js
 */

require('dotenv').config(); // Load environment variables
const { db, admin } = require('../config/firebase');

// Configuration
const MIN_COMPLEXITY = 15;
const TARGET_AGENT_COUNT = 400;
const MIN_PRICE = 30;
const MAX_PRICE = 70;
const BATCH_SIZE = 100; // Firebase batch limit is 500, using 100 for safety

/**
 * Generate a random price between min and max
 * @param {number} min - Minimum price
 * @param {number} max - Maximum price
 * @returns {number} Random price
 */
const generateRandomPrice = (min, max) => {
  // Generate random price with some common price points
  const randomValue = Math.random();
  
  // 30% chance for round numbers (30, 35, 40, 45, 50, 55, 60, 65, 70)
  if (randomValue < 0.3) {
    const roundPrices = [30, 35, 40, 45, 50, 55, 60, 65, 70];
    return roundPrices[Math.floor(Math.random() * roundPrices.length)];
  }
  
  // 70% chance for random prices
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

/**
 * Shuffle array using Fisher-Yates algorithm
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array
 */
const shuffleArray = (array) => {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

/**
 * Get all agents with complexity > threshold
 * @param {number} minComplexity - Minimum complexity threshold
 * @returns {Promise<Array>} Array of agent documents
 */
const getEligibleAgents = async (minComplexity) => {
  try {
    console.log(`🔍 Fetching agents with nodeCount > ${minComplexity}...`);
    
    // Query agents with workflowMetadata.nodeCount greater than threshold
    const agentsSnapshot = await db
      .collection('agents')
      .where('workflowMetadata.nodeCount', '>', minComplexity)
      .get();
    
    const agents = [];
    agentsSnapshot.forEach(doc => {
      agents.push({
        id: doc.id,
        data: doc.data()
      });
    });
    
    console.log(`📊 Found ${agents.length} agents with nodeCount > ${minComplexity}`);
    return agents;
  } catch (error) {
    console.error('❌ Error fetching eligible agents:', error);
    throw error;
  }
};

/**
 * Update agents with prices in batches
 * @param {Array} agentsToUpdate - Array of agents to update
 * @returns {Promise<void>}
 */
const updateAgentPrices = async (agentsToUpdate) => {
  try {
    console.log(`💰 Updating prices for ${agentsToUpdate.length} agents...`);
    
    let updatedCount = 0;
    const totalBatches = Math.ceil(agentsToUpdate.length / BATCH_SIZE);
    
    for (let i = 0; i < agentsToUpdate.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const currentBatch = agentsToUpdate.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      
      console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${currentBatch.length} agents)...`);
      
      currentBatch.forEach(agent => {
        const agentRef = db.collection('agents').doc(agent.id);
        
        // Update agent with price and pricing metadata
        batch.update(agentRef, {
          price: agent.price,
          isFree: false,
          isPaid: true,
          priceType: 'fixed',
          currency: 'USD',
          pricingTier: agent.price <= 40 ? 'basic' : agent.price <= 60 ? 'premium' : 'enterprise',
          lastPriceUpdate: admin.firestore.FieldValue.serverTimestamp(),
          pricingSource: 'automated_script',
          pricingMetadata: {
            scriptVersion: '1.0',
            assignedAt: new Date().toISOString(),
            originalComplexity: agent.data.workflowMetadata?.nodeCount,
            priceRange: `${MIN_PRICE}-${MAX_PRICE}`,
            selectionCriteria: `complexity > ${MIN_COMPLEXITY}`
          }
        });
      });
      
      await batch.commit();
      updatedCount += currentBatch.length;
      console.log(`✅ Updated ${updatedCount}/${agentsToUpdate.length} agents`);
      
      // Small delay between batches to avoid rate limiting
      if (i + BATCH_SIZE < agentsToUpdate.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`🎉 Successfully updated all ${updatedCount} agents with prices!`);
  } catch (error) {
    console.error('❌ Error updating agent prices:', error);
    throw error;
  }
};

/**
 * Generate summary report of the pricing operation
 * @param {Array} selectedAgents - Array of selected agents
 * @returns {Object} Summary report
 */
const generateSummary = (selectedAgents) => {
  const prices = selectedAgents.map(agent => agent.price);
  const complexities = selectedAgents.map(agent => agent.data.workflowMetadata?.nodeCount || 0);
  
  const priceStats = {
    min: Math.min(...prices),
    max: Math.max(...prices),
    avg: Math.round(prices.reduce((sum, price) => sum + price, 0) / prices.length),
    median: prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)]
  };
  
  const complexityStats = {
    min: Math.min(...complexities),
    max: Math.max(...complexities),
    avg: Math.round(complexities.reduce((sum, complexity) => sum + complexity, 0) / complexities.length)
  };
  
  const priceDistribution = {};
  const tierDistribution = { basic: 0, premium: 0, enterprise: 0 };
  
  selectedAgents.forEach(agent => {
    priceDistribution[agent.price] = (priceDistribution[agent.price] || 0) + 1;
    
    if (agent.price <= 40) tierDistribution.basic++;
    else if (agent.price <= 60) tierDistribution.premium++;
    else tierDistribution.enterprise++;
  });
  
  return {
    totalSelected: selectedAgents.length,
    priceStats,
    complexityStats,
    tierDistribution,
    topPrices: Object.entries(priceDistribution)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([price, count]) => ({ price: `$${price}`, count }))
  };
};

/**
 * Main execution function
 */
const main = async () => {
  console.log('🚀 Starting Agent Price Population Script');
  console.log('==========================================');
      console.log(`Target: ${TARGET_AGENT_COUNT} agents with nodeCount > ${MIN_COMPLEXITY}`);
  console.log(`Price range: $${MIN_PRICE} - $${MAX_PRICE}`);
  console.log('');
  
  try {
    // Verify Firebase connection
    console.log('🔧 Verifying Firebase connection...');
    try {
      await db.collection('_test_connection').doc('test').set({
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      await db.collection('_test_connection').doc('test').delete();
      console.log('✅ Firebase connection verified!');
    } catch (error) {
      console.error('❌ Firebase connection failed:', error);
      console.error('Please check your Firebase configuration.');
      process.exit(1);
    }
    
    // Step 1: Get all eligible agents
    const eligibleAgents = await getEligibleAgents(MIN_COMPLEXITY);
    
    if (eligibleAgents.length === 0) {
      console.log('❌ No agents found with the specified nodeCount threshold.');
      process.exit(0);
    }
    
    if (eligibleAgents.length < TARGET_AGENT_COUNT) {
      console.log(`⚠️  Only ${eligibleAgents.length} agents available, less than target ${TARGET_AGENT_COUNT}`);
      console.log('Proceeding with all available agents...');
    }
    
    // Step 2: Randomly select agents
    const shuffledAgents = shuffleArray(eligibleAgents);
    const selectedAgents = shuffledAgents.slice(0, Math.min(TARGET_AGENT_COUNT, eligibleAgents.length));
    
    console.log(`🎯 Randomly selected ${selectedAgents.length} agents for pricing`);
    
    // Step 3: Assign random prices
    const agentsWithPrices = selectedAgents.map(agent => ({
      ...agent,
      price: generateRandomPrice(MIN_PRICE, MAX_PRICE)
    }));
    
    console.log('💲 Generated random prices for selected agents');
    
    // Step 4: Generate summary before update
    const summary = generateSummary(agentsWithPrices);
    console.log('');
    console.log('📈 PRICING SUMMARY');
    console.log('==================');
    console.log(`Total agents to update: ${summary.totalSelected}`);
    console.log(`Price range: $${summary.priceStats.min} - $${summary.priceStats.max}`);
    console.log(`Average price: $${summary.priceStats.avg}`);
    console.log(`Median price: $${summary.priceStats.median}`);
    console.log('');
    console.log('Tier distribution:');
    console.log(`  Basic ($30-40): ${summary.tierDistribution.basic} agents`);
    console.log(`  Premium ($41-60): ${summary.tierDistribution.premium} agents`);
    console.log(`  Enterprise ($61-70): ${summary.tierDistribution.enterprise} agents`);
    console.log('');
    console.log('Top prices:');
    summary.topPrices.forEach(({ price, count }) => {
      console.log(`  ${price}: ${count} agents`);
    });
    console.log('');
    console.log(`Complexity range: ${summary.complexityStats.min} - ${summary.complexityStats.max} (avg: ${summary.complexityStats.avg})`);
    console.log('');
    
    // Confirmation prompt
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const confirmation = await new Promise((resolve) => {
      rl.question('Do you want to proceed with updating these agents? (y/N): ', (answer) => {
        rl.close();
        resolve(answer.toLowerCase());
      });
    });
    
    if (confirmation !== 'y' && confirmation !== 'yes') {
      console.log('❌ Operation cancelled by user.');
      process.exit(0);
    }
    
    // Step 5: Update agents in Firebase
    await updateAgentPrices(agentsWithPrices);
    
    // Final success message
    console.log('');
    console.log('🎉 OPERATION COMPLETED SUCCESSFULLY!');
    console.log('====================================');
    console.log(`✅ Updated ${agentsWithPrices.length} agents with prices`);
    console.log(`💰 Price range: $${MIN_PRICE} - $${MAX_PRICE}`);
    console.log(`🧠 NodeCount threshold: > ${MIN_COMPLEXITY}`);
    console.log('');
    console.log('All agents now have:');
    console.log('  ✓ Random price assigned');
    console.log('  ✓ isPaid = true');
    console.log('  ✓ isFree = false');
    console.log('  ✓ Pricing metadata');
    console.log('  ✓ Timestamp of update');
    
  } catch (error) {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  }
};

// Execute the script
if (require.main === module) {
  main();
}

module.exports = {
  main,
  generateRandomPrice,
  getEligibleAgents,
  updateAgentPrices
}; 