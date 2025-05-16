const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// Initialize Firebase Admin
try {
  admin.initializeApp();
} catch (error) {
  console.log('Firebase admin already initialized');
}

const db = admin.firestore();

/**
 * Updates user documents to ensure they have required arrays for review eligibility
 * - Adds purchases array if missing
 * - Adds downloads array if missing
 * - Sets 'admin' role for specified user
 */
async function updateUserRecords() {
  console.log('Starting user records update...');
  
  // Get all users
  const usersSnapshot = await db.collection('users').get();
  console.log(`Found ${usersSnapshot.size} user documents`);
  
  const updatePromises = [];
  
  usersSnapshot.forEach(userDoc => {
    const userData = userDoc.data();
    const updates = {};
    let needsUpdate = false;
    
    // Add empty purchases array if missing
    if (!userData.purchases) {
      updates.purchases = [];
      needsUpdate = true;
      console.log(`Adding purchases array to user ${userData.email || userDoc.id}`);
    }
    
    // Add empty downloads array if missing
    if (!userData.downloads) {
      updates.downloads = [];
      needsUpdate = true;
      console.log(`Adding downloads array to user ${userData.email || userDoc.id}`);
    }
    
    // Make specified user an admin for testing
    if (userData.email === 'sakhr270@gmail.com' && userData.role !== 'admin') {
      updates.role = 'admin';
      needsUpdate = true;
      console.log(`Setting ${userData.email} as admin`);
    }
    
    if (needsUpdate) {
      const updatePromise = db.collection('users').doc(userDoc.id).update(updates);
      updatePromises.push(updatePromise);
    }
  });
  
  if (updatePromises.length > 0) {
    await Promise.all(updatePromises);
    console.log(`Updated ${updatePromises.length} user documents`);
  } else {
    console.log('No user documents needed updating');
  }
}

/**
 * Create agent_downloads collection if it doesn't exist
 */
async function ensureAgentDownloadsCollection() {
  // We'll check if we have any documents in the collection
  const downloadsSnapshot = await db.collection('agent_downloads').limit(1).get();
  
  if (downloadsSnapshot.empty) {
    console.log('agent_downloads collection is empty, creating sample document...');
    
    // Create a sample document to ensure the collection exists
    await db.collection('agent_downloads').doc('sample_download').set({
      agentId: 'sample_agent_id',
      userId: 'sample_user_id',
      downloadDate: admin.firestore.FieldValue.serverTimestamp(),
      isPlaceholder: true
    });
    console.log('Created sample document in agent_downloads collection');
  } else {
    console.log('agent_downloads collection already exists');
  }
}

/**
 * Updates purchase records to associate with agents
 */
async function linkPurchasesToAgents() {
  console.log('Checking for orders/transactions to link to agents...');
  
  // This would depend on your e-commerce implementation
  // For now, we'll add some demo purchase records to the admin user for testing
  
  try {
    // Get admin user
    const adminSnapshot = await db.collection('users').where('email', '==', 'sakhr270@gmail.com').limit(1).get();
    
    if (!adminSnapshot.empty) {
      const adminDoc = adminSnapshot.docs[0];
      
      // Get some agents to link to purchases
      const agentsSnapshot = await db.collection('agents').limit(5).get();
      
      if (!agentsSnapshot.empty) {
        const adminData = adminDoc.data();
        const purchases = adminData.purchases || [];
        
        // Add agents to purchases array if not already there
        let purchasesUpdated = false;
        
        agentsSnapshot.forEach(agentDoc => {
          const agentData = agentDoc.data();
          const agentId = agentDoc.id;
          
          // Check if this agent is already in purchases
          const existing = purchases.find(p => p.agentId === agentId);
          
          if (!existing) {
            purchases.push({
              agentId: agentId,
              productId: agentId,
              title: agentData.title || 'Sample Agent',
              price: agentData.price || { basePrice: 9.99 },
              purchaseDate: admin.firestore.Timestamp.now(),
              orderId: `demo_order_${Date.now()}_${Math.floor(Math.random() * 1000)}`
            });
            purchasesUpdated = true;
            console.log(`Added agent ${agentId} to admin user's purchases`);
          }
        });
        
        if (purchasesUpdated) {
          await db.collection('users').doc(adminDoc.id).update({ purchases });
          console.log('Updated admin user with demo purchases');
        } else {
          console.log('Admin user already has demo purchases');
        }
      } else {
        console.log('No agents found to link to purchases');
      }
    } else {
      console.log('Admin user not found');
    }
  } catch (error) {
    console.error('Error linking purchases to agents:', error);
  }
}

/**
 * Main function to run all updates
 */
async function main() {
  try {
    // Update user documents
    await updateUserRecords();
    
    // Ensure agent_downloads collection exists
    await ensureAgentDownloadsCollection();
    
    // Link purchases to agents for testing
    await linkPurchasesToAgents();
    
    console.log('All updates completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error updating database:', error);
    process.exit(1);
  }
}

// Run the main function
main(); 