// Script to check if collections exist in the database and populate them if needed
// Checks and seeds: agents, wishlists, featured agents, and recommended agents
require('dotenv').config(); // Load environment variables
const { db, admin } = require('../config/firebase');
const agentsController = require('../controllers/agent/agentsController');

const checkAndSeedCollections = async () => {
  try {
    console.log('Checking if all required collections exist in the database...');
    
    // Verify Firebase configuration first
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
    
    // Check if agents already exist
    const existingAgentsSnapshot = await db.collection('agents').limit(10).get();
    
    if (!existingAgentsSnapshot.empty) {
      const count = existingAgentsSnapshot.size;
      console.log(`✅ Agents collection exists with at least ${count} document(s).`);
      console.log('No seeding necessary for agents collection.');
    } else {
      console.log('⚠️ Agents collection is empty or doesn\'t exist.');
      console.log('Proceeding to seed the database with mock agents...');
      
      // Generate mock agents
      const count = 50; // Default number of agents to create
      const agents = agentsController.generateMockAgents(count);
      
      // Enhance agents with popularity metrics and other attributes
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
        
        // Calculate base price
        const isFree = agent.isFree || false;
        const basePrice = isFree ? 0 : (agent.priceDetails?.basePrice || (5 + Math.floor(Math.random() * 95)));
        
        return {
          ...agent,
          popularity,
          isFeatured,
          isTrending,
          viewCount,
          wishlistCount,
          tags,
          features,
          priceDetails: agent.priceDetails || {
            basePrice,
            discountedPrice: isFree ? 0 : (Math.random() > 0.7 ? Math.floor(basePrice * 0.7) : basePrice),
            currency: "USD",
            validUntil: Math.random() > 0.8 ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() : null
          },
          purchase: agent.purchase || {
            isAvailable: true,
            maxPurchasesPerUser: Math.random() > 0.9 ? 1 : null,
            refundPolicy: ["No refunds allowed", "7-day refund policy", "30-day money-back guarantee"][Math.floor(Math.random() * 3)]
          },
          version: agent.version || `1.${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 10)}`,
          priceHistory: agent.priceHistory || (isFree ? [] : [
            {
              price: basePrice + 5,
              discountedPrice: basePrice,
              dateApplied: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
            }
          ])
        };
      });
      
      // Create batch operations for efficient writes
      let successCount = 0;
      let batchCount = 0;
      let batch = db.batch();
      
      // Add each agent to the batch
      enhancedAgents.forEach((agent, index) => {
        const agentRef = db.collection('agents').doc(agent.id);
        batch.set(agentRef, agent);
        
        // Commit batch when it reaches 500 operations (Firestore limit)
        if ((index + 1) % 500 === 0) {
          batchCount++;
          batch.commit()
            .then(() => {
              console.log(`Batch ${batchCount} committed successfully.`);
              successCount += 500;
            })
            .catch(error => {
              console.error(`Error committing batch ${batchCount}:`, error);
            });
          
          // Create a new batch
          batch = db.batch();
        }
      });
      
      // Commit the remaining operations
      if (enhancedAgents.length % 500 > 0) {
        batchCount++;
        await batch.commit()
          .then(() => {
            console.log(`Final batch ${batchCount} committed successfully.`);
            successCount += enhancedAgents.length % 500;
          })
          .catch(error => {
            console.error(`Error committing final batch ${batchCount}:`, error);
          });
      }
      
      console.log(`✅ Successfully added ${successCount} agents to the database.`);
    }
    
    // Check if wishlists already exist
    const wishlistSnapshot = await db.collection('wishlists').limit(5).get();
    
    if (!wishlistSnapshot.empty) {
      const count = wishlistSnapshot.size;
      console.log(`✅ Wishlists collection exists with at least ${count} document(s).`);
      console.log('No seeding necessary for wishlists collection.');
    } else {
      console.log('⚠️ Wishlists collection is empty or doesn\'t exist.');
      console.log('Proceeding to seed the database with mock wishlists...');
      
      // Get all agents to reference in wishlists
      const agentsSnapshot = await db.collection('agents').get();
      const allAgents = [];
      agentsSnapshot.forEach(doc => {
        allAgents.push({ id: doc.id, ...doc.data() });
      });
      
      if (allAgents.length === 0) {
        console.error('No agents found in the database to create wishlists. Skipping wishlist creation.');
      } else {
        // Generate 10 mock wishlists
        const wishlists = [];
        
        for (let i = 0; i < 10; i++) {
          // Randomly select 3-6 agents for each wishlist
          const numItems = 3 + Math.floor(Math.random() * 4);
          const items = [];
          
          // Select random agents avoiding duplicates
          const selectedAgentIds = new Set();
          while (items.length < numItems && selectedAgentIds.size < Math.min(numItems, allAgents.length)) {
            const randomIndex = Math.floor(Math.random() * allAgents.length);
            const agent = allAgents[randomIndex];
            
            if (!selectedAgentIds.has(agent.id)) {
              selectedAgentIds.add(agent.id);
              items.push({
                id: agent.id,
                name: agent.title || agent.name,
                imageUrl: agent.imageUrl,
                price: agent.price
              });
            }
          }
          
          // Create the wishlist
          wishlists.push({
            id: `wishlist-${i + 1}`,
            name: `Wishlist ${i + 1}`,
            description: `A collection of ${numItems} interesting AI agents`,
            creator: {
              id: `user-${i % 5 + 1}`,
              name: `User ${i % 5 + 1}`,
              avatar: `https://i.pravatar.cc/150?img=${i % 5 + 10}`
            },
            items,
            createdAt: admin.firestore.Timestamp.fromDate(new Date()),
            likes: Math.floor(Math.random() * 100),
            views: Math.floor(Math.random() * 500)
          });
        }
        
        // Create a batch for wishlists
        let wishlistBatch = db.batch();
        
        // Add each wishlist to the batch
        wishlists.forEach((wishlist, index) => {
          const wishlistRef = db.collection('wishlists').doc(wishlist.id);
          wishlistBatch.set(wishlistRef, wishlist);
          
          // Commit batch when it reaches 500 operations (Firestore limit)
          if ((index + 1) % 500 === 0) {
            wishlistBatch.commit()
              .then(() => {
                console.log(`Wishlist batch committed successfully.`);
              })
              .catch(error => {
                console.error(`Error committing wishlist batch:`, error);
              });
            
            // Create a new batch
            wishlistBatch = db.batch();
          }
        });
        
        // Commit the remaining operations
        if (wishlists.length % 500 > 0) {
          await wishlistBatch.commit()
            .then(() => {
              console.log(`Final wishlist batch committed successfully.`);
            })
            .catch(error => {
              console.error(`Error committing final wishlist batch:`, error);
            });
        }
        
        console.log(`✅ Successfully added ${wishlists.length} wishlists to the database.`);
      }
    }

    // Check if featured agents are explicitly marked in the database
    const featuredSnapshot = await db.collection('agents').where('isFeatured', '==', true).limit(5).get();
    
    if (!featuredSnapshot.empty) {
      const count = featuredSnapshot.size;
      console.log(`✅ Featured agents exist with at least ${count} document(s).`);
    } else {
      console.log('⚠️ No featured agents found in the database.');
      console.log('Marking some agents as featured...');
      
      // Get all agents to update
      const agentsSnapshot = await db.collection('agents').limit(50).get();
      const agentsToUpdate = [];
      agentsSnapshot.forEach(doc => {
        agentsToUpdate.push({ id: doc.id, ...doc.data() });
      });
      
      if (agentsToUpdate.length === 0) {
        console.error('No agents found in the database to mark as featured. Skipping feature marking.');
      } else {
        // Mark 20% of agents as featured
        const featuredCount = Math.ceil(agentsToUpdate.length * 0.2);
        const selectedIndices = new Set();
        
        // Randomly select agents to mark as featured
        while (selectedIndices.size < featuredCount) {
          const randomIndex = Math.floor(Math.random() * agentsToUpdate.length);
          selectedIndices.add(randomIndex);
        }
        
        // Create a batch for updates
        let updateBatch = db.batch();
        let updatedCount = 0;
        
        // Mark selected agents as featured
        selectedIndices.forEach(index => {
          const agent = agentsToUpdate[index];
          const agentRef = db.collection('agents').doc(agent.id);
          updateBatch.update(agentRef, { isFeatured: true });
          updatedCount++;
          
          // Commit batch when it reaches 500 operations (Firestore limit)
          if (updatedCount % 500 === 0) {
            updateBatch.commit()
              .then(() => {
                console.log(`Feature update batch committed successfully.`);
              })
              .catch(error => {
                console.error(`Error committing feature update batch:`, error);
              });
            
            // Create a new batch
            updateBatch = db.batch();
          }
        });
        
        // Commit the remaining operations
        if (updatedCount % 500 > 0) {
          await updateBatch.commit()
            .then(() => {
              console.log(`Final feature update batch committed successfully.`);
            })
            .catch(error => {
              console.error(`Error committing final feature update batch:`, error);
            });
        }
        
        console.log(`✅ Successfully marked ${updatedCount} agents as featured in the database.`);
      }
    }

    // Check if there are agents with high ratings for recommended section
    const topRatedSnapshot = await db.collection('agents').where('rating.average', '>=', 4.5).limit(5).get();

    if (!topRatedSnapshot.empty) {
      const count = topRatedSnapshot.size;
      console.log(`✅ Top-rated agents exist with at least ${count} document(s).`);
    } else {
      console.log('⚠️ No top-rated agents found in the database.');
      console.log('Adding ratings to some agents for recommended section...');
      
      // Get all agents to update
      const agentsSnapshot = await db.collection('agents').limit(50).get();
      const agentsToUpdate = [];
      agentsSnapshot.forEach(doc => {
        agentsToUpdate.push({ id: doc.id, ...doc.data() });
      });
      
      if (agentsToUpdate.length === 0) {
        console.error('No agents found in the database to update ratings. Skipping rating updates.');
      } else {
        // Select 30% of agents to be top-rated (for recommended section)
        const topRatedCount = Math.ceil(agentsToUpdate.length * 0.3);
        const selectedIndices = new Set();
        
        // Randomly select agents to mark as top-rated
        while (selectedIndices.size < topRatedCount) {
          const randomIndex = Math.floor(Math.random() * agentsToUpdate.length);
          selectedIndices.add(randomIndex);
        }
        
        // Create a batch for updates
        let updateBatch = db.batch();
        let updatedCount = 0;
        
        // Update ratings for selected agents
        selectedIndices.forEach(index => {
          const agent = agentsToUpdate[index];
          const agentRef = db.collection('agents').doc(agent.id);
          
          // Create a high rating (4.5-5.0) with reasonable number of reviews
          const rating = {
            average: 4.5 + (Math.random() * 0.5), // Between 4.5 and 5.0
            count: 10 + Math.floor(Math.random() * 90) // Between 10 and 99 reviews
          };
          
          updateBatch.update(agentRef, { rating });
          updatedCount++;
          
          // Commit batch when it reaches 500 operations (Firestore limit)
          if (updatedCount % 500 === 0) {
            updateBatch.commit()
              .then(() => {
                console.log(`Rating update batch committed successfully.`);
              })
              .catch(error => {
                console.error(`Error committing rating update batch:`, error);
              });
            
            // Create a new batch
            updateBatch = db.batch();
          }
        });
        
        // Commit the remaining operations
        if (updatedCount % 500 > 0) {
          await updateBatch.commit()
            .then(() => {
              console.log(`Final rating update batch committed successfully.`);
            })
            .catch(error => {
              console.error(`Error committing final rating update batch:`, error);
            });
        }
        
        console.log(`✅ Successfully updated ratings for ${updatedCount} agents in the database.`);
      }
    }
    
    console.log('\n✅ Database check and seeding completed successfully!');
    console.log('The API endpoints should now have data to work with.');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during database check and seeding:', error);
    process.exit(1);
  }
};

// Run the function
checkAndSeedCollections();