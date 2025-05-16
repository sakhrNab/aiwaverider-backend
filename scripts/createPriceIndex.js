/**
 * Script to create the required Firestore composite index
 * and update price documents to ensure they have createdAt fields
 */

const { db, admin } = require('../config/firebase');

const createPriceIndex = async () => {
  try {
    console.log('Starting Firestore index creation and document update process...');

    // 1. Update price documents that don't have a createdAt field
    const pricesSnapshot = await db.collection('prices').get();
    
    if (pricesSnapshot.empty) {
      console.log('No price documents found to update.');
    } else {
      console.log(`Found ${pricesSnapshot.size} price documents to check for createdAt field.`);
      
      // Create a write batch for efficient updates
      let batch = db.batch();
      let updatedCount = 0;
      
      for (const doc of pricesSnapshot.docs) {
        const priceData = doc.data();
        
        // If document doesn't have createdAt field, add it
        if (!priceData.createdAt) {
          console.log(`Adding createdAt field to price document ${doc.id}`);
          
          // Use updatedAt as createdAt if available, otherwise use current timestamp
          const createdAt = priceData.updatedAt || new Date().toISOString();
          batch.update(doc.ref, { createdAt });
          
          updatedCount++;
          
          // Commit batch every 500 operations (Firestore limit)
          if (updatedCount % 500 === 0) {
            await batch.commit();
            console.log(`Committed batch of ${updatedCount} document updates.`);
            batch = db.batch();
          }
        }
      }
      
      // Commit any remaining operations
      if (updatedCount % 500 > 0) {
        await batch.commit();
        console.log(`Committed final batch of ${updatedCount % 500} document updates.`);
      }
      
      console.log(`Updated ${updatedCount} price documents with createdAt field.`);
    }
    
    // 2. Display instructions for creating the index
    console.log('\n==== COMPOSITE INDEX CREATION ====');
    console.log('To create the required composite index, please:');
    console.log('1. Go to the Firebase console: https://console.firebase.google.com/');
    console.log('2. Select your project: aiwaverider');
    console.log('3. Navigate to Firestore Database > Indexes > Composite');
    console.log('4. Click "Create Index"');
    console.log('5. Fill in the following details:');
    console.log('   - Collection: prices');
    console.log('   - Fields to index:');
    console.log('     > agentId (Ascending)');
    console.log('     > createdAt (Descending)');
    console.log('6. Click "Create"');
    console.log('\nAlternatively, you can directly navigate to this URL:');
    console.log('https://console.firebase.google.com/v1/r/project/aiwaverider/firestore/indexes?create_composite=Ckpwcm9qZWN0cy9haXdhdmVyaWRlci9kYXRhYmFzZXMvKGRlZmF1bHQpL2NvbGxlY3Rpb25Hcm91cHMvcHJpY2VzL2luZGV4ZXMvXxABGgsKB2FnZW50SWQQARoNCgljcmVhdGVkQXQQAhoMCghfX25hbWVfXxAC');
    
    console.log('\nProcess completed successfully.');
  } catch (error) {
    console.error('Error in index creation process:', error);
  }
};

// Run the function if this script is executed directly
if (require.main === module) {
  createPriceIndex()
    .then(() => {
      console.log('Script execution completed.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script execution failed:', error);
      process.exit(1);
    });
}

module.exports = { createPriceIndex }; 