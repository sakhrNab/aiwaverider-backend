// Script to seed the database with mock agents
require('dotenv').config(); // Load environment variables
const { db, admin } = require('../config/firebase');
const agentsController = require('../controllers/agent/agentsController');

const seedDatabase = async () => {
  try {
    console.log('Starting database seeding with mock agents...');
    
    // Verify Firebase configuration
    try {
      // Try a simple Firebase operation to verify connection
      await db.collection('_test_connection').doc('test').set({
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Clean up the test document
      await db.collection('_test_connection').doc('test').delete();
      
      console.log('✅ Firebase connection verified successfully!');
    } catch (error) {
      console.error('❌ Firebase connection failed!', error);
      console.error('Please check your Firebase configuration in .env file.');
      console.error('Make sure FIREBASE_SERVICE_ACCOUNT_PATH is correctly set.');
      process.exit(1);
    }
    
    // Check if agents already exist to avoid duplicates
    const existingAgentsSnapshot = await db.collection('agents').limit(1).get();
    
    if (!existingAgentsSnapshot.empty) {
      console.warn('WARNING: Agents collection already has data!');
      const response = await prompt('Do you want to continue and potentially create duplicates? (y/n): ');
      if (response.toLowerCase() !== 'y') {
        console.log('Seeding cancelled.');
        process.exit(0);
      }
    }
    
    // Generate mock agents
    const count = process.argv[2] ? parseInt(process.argv[2]) : 50;
    console.log(`Generating ${count} mock agents...`);
    
    const agents = agentsController.generateMockAgents(count);
    
    // Enhance agents with popularity metrics
    const enhancedAgents = agents.map((agent, index) => {
      // Add popularity metrics - make some agents more popular than others
      const popularity = Math.floor(Math.random() * 1000); // 0-999 popularity score
      
      // Make approximately 20% of agents "featured"
      const isFeatured = index % 5 === 0;
      
      // Add trending flag to some agents (around 10%)
      const isTrending = index % 10 === 0;
      
      // Generate view count - correlate with popularity
      const viewCount = popularity * (5 + Math.floor(Math.random() * 20));
      
      // Track wishlist count separately
      const wishlistCount = Math.floor(popularity * 0.3);

      // Add tags if not present
      const tags = agent.tags || [
        'AI', 'Productivity', 'Assistant', 'Creative', 'Education', 
        'Entertainment', 'Professional', 'Communication', 'Automation'
      ].sort(() => 0.5 - Math.random()).slice(0, 2 + Math.floor(Math.random() * 3));
      
      // Add features if not present
      const features = agent.features || [
        'API Access', 'Customizable', 'Mobile Compatible', 
        'Desktop App', 'Web Interface', 'Voice Enabled', 
        'AI Powered', 'Cloud Storage', 'Offline Mode'
      ].sort(() => 0.5 - Math.random()).slice(0, 2 + Math.floor(Math.random() * 3));
      
      return {
        ...agent,
        popularity,
        isFeatured,
        isTrending,
        viewCount,
        wishlistCount,
        tags,
        features
      };
    });
    
    // Create batch operations for efficient writes
    let successCount = 0;
    let batchCount = 0;
    let batch = db.batch();
    
    // Add each agent to the batch
    for (let i = 0; i < enhancedAgents.length; i++) {
      const agent = enhancedAgents[i];
      const agentRef = db.collection('agents').doc(agent.id);
      
      // Extract reviews to store in a subcollection
      const reviews = agent.reviews || [];
      delete agent.reviews; // Remove from main document
      
      // Add agent document
      batch.set(agentRef, agent);
      
      // Add each review to the agent's reviews subcollection
      if (reviews.length > 0) {
        for (const review of reviews) {
          const reviewRef = agentRef.collection('reviews').doc(review.id);
          batch.set(reviewRef, review);
        }
      }
      
      // Firestore has a limit of 500 operations per batch
      // So we commit the batch every 20 documents (considering reviews)
      if ((i + 1) % 20 === 0 || i === enhancedAgents.length - 1) {
        await batch.commit();
        successCount += Math.min(20, enhancedAgents.length - i + (i % 20));
        batchCount++;
        console.log(`Batch ${batchCount} committed. ${successCount}/${enhancedAgents.length} agents processed.`);
        
        // Create a new batch for the next set of operations
        if (i < enhancedAgents.length - 1) {
          batch = db.batch();
        }
      }
    }

    // Create mock user wishlists and interactions
    console.log('\nCreating mock user wishlists and interactions...');
    await createMockUserInteractions(enhancedAgents);
    
    console.log(`\nSeeding completed! ${successCount} agents added to the database.`);
    console.log(`To fetch these agents in your application, use the /api/agents endpoint.`);
    process.exit(0);
  } catch (error) {
    console.error('Error seeding database:', error);
    process.exit(1);
  }
};

/**
 * Create mock user wishlists and interactions with agents
 */
const createMockUserInteractions = async (agents) => {
  try {
    // Create 10 mock users with preferences
    const mockUsers = [];
    for (let i = 0; i < 10; i++) {
      mockUsers.push({
        id: `mock-user-${i+1}`,
        name: `Test User ${i+1}`,
        email: `testuser${i+1}@example.com`,
        interests: [
          'AI', 'Productivity', 'Assistant', 'Creative', 'Education', 
          'Entertainment', 'Professional', 'Communication', 'Automation'
        ].sort(() => 0.5 - Math.random()).slice(0, 3)
      });
    }
    
    // Create batch for user operations
    let batch = db.batch();
    let operationCount = 0;
    let userBatchCount = 0;
    
    // Store users and their preferences
    for (const user of mockUsers) {
      const userRef = db.collection('users').doc(user.id);
      batch.set(userRef, user);
      operationCount++;
      
      // Add random agents to user's wishlist (3-7 agents per user)
      const wishlistCount = 3 + Math.floor(Math.random() * 5);
      const shuffledAgents = [...agents].sort(() => 0.5 - Math.random());
      
      for (let i = 0; i < wishlistCount && i < shuffledAgents.length; i++) {
        const agent = shuffledAgents[i];
        const wishlistRef = db.collection('wishlists').doc(`${user.id}_${agent.id}`);
        
        batch.set(wishlistRef, {
          userId: user.id,
          agentId: agent.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          // Add some metadata about why this agent is in wishlist
          notes: `Added to wishlist for ${agent.tags ? agent.tags.join(', ') : 'general use'}`
        });
        
        operationCount++;
      }
      
      // Commit batch every 100 operations due to Firestore limits
      if (operationCount >= 100) {
        await batch.commit();
        userBatchCount++;
        console.log(`User batch ${userBatchCount} committed.`);
        batch = db.batch();
        operationCount = 0;
      }
    }
    
    // Commit any remaining operations
    if (operationCount > 0) {
      await batch.commit();
      userBatchCount++;
      console.log(`Final user batch ${userBatchCount} committed.`);
    }
    
    console.log(`Created ${mockUsers.length} mock users with wishlists and preferences.`);
    return true;
  } catch (error) {
    console.error('Error creating mock user interactions:', error);
    return false;
  }
};

// Simple prompt function for console input
function prompt(question) {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    readline.question(question, (answer) => {
      readline.close();
      resolve(answer);
    });
  });
}

// Run the seeding function
seedDatabase(); 