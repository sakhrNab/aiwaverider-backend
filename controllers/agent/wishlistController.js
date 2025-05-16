const { db, admin } = require('../../config/firebase');

// Modify this line to handle the case where sanitize might not be available
let sanitizeObject;
try {
  // Try to load the sanitize utility
  const sanitizeUtils = require('../../utils/sanitize');
  sanitizeObject = sanitizeUtils.sanitizeObject;
} catch (err) {
  // If sanitize utility isn't available, create a simple passthrough function
  console.log('Sanitize utility not available, using fallback');
  sanitizeObject = (obj) => obj;
}

/**
 * Get all wishlists
 */
exports.getWishlists = async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const limitNum = parseInt(limit, 10);
    
    // Get all public wishlists
    const wishlistsSnapshot = await db.collection('wishlists')
      .where('isPublic', '==', true)
      .orderBy('createdAt', 'desc')
      .limit(limitNum)
      .get();
    
    if (wishlistsSnapshot.empty) {
      return res.json({ wishlists: [] });
    }
    
    const wishlists = [];
    
    // Process each wishlist
    for (const doc of wishlistsSnapshot.docs) {
      try {
        const wishlistData = doc.data();
        
        // Get creator info
        let creatorData = null;
        if (wishlistData.creatorId) {
          try {
            const creatorDoc = await db.collection('users').doc(wishlistData.creatorId).get();
            if (creatorDoc.exists) {
              const creatorDocData = creatorDoc.data() || {};
              creatorData = {
                id: creatorDoc.id,
                name: creatorDocData.username || creatorDocData.displayName || 'Unknown User',
                avatar: creatorDocData.photoURL || null
              };
            }
          } catch (creatorError) {
            console.error('Error getting creator data:', creatorError);
            // Continue with null creatorData
          }
        }
        
        // Get first few items in the wishlist
        const itemsSnapshot = await db.collection('wishlists')
          .doc(doc.id)
          .collection('items')
          .limit(4)
          .get();
        
        const items = [];
        
        for (const itemDoc of itemsSnapshot.docs) {
          try {
            const itemData = itemDoc.data() || {};
            
            // Get basic agent info
            let agentData = null;
            if (itemData.agentId) {
              try {
                const agentDoc = await db.collection('agents').doc(itemData.agentId).get();
                if (agentDoc.exists) {
                  const agent = agentDoc.data() || {};
                  agentData = {
                    id: agentDoc.id,
                    title: agent.title || agent.name || 'Unnamed Agent',
                    imageUrl: agent.imageUrl || null
                  };
                }
              } catch (agentError) {
                console.error('Error getting agent data:', agentError);
                // Continue with null agentData
              }
            }
            
            // Safely convert dates
            let addedAtDate = null;
            if (itemData.addedAt) {
              try {
                addedAtDate = itemData.addedAt.toDate();
              } catch (dateError) {
                console.error('Error converting addedAt date:', dateError);
                // Keep as null
              }
            }
            
            items.push({
              id: itemDoc.id,
              agentId: itemData.agentId || null,
              addedAt: addedAtDate,
              ...agentData
            });
          } catch (itemError) {
            console.error('Error processing wishlist item:', itemError);
            // Skip this item and continue
          }
        }
        
        // Safely convert dates
        let createdAtDate = null;
        let updatedAtDate = null;
        
        if (wishlistData.createdAt) {
          try {
            createdAtDate = wishlistData.createdAt.toDate();
          } catch (dateError) {
            console.error('Error converting createdAt date:', dateError);
            // Keep as null
          }
        }
        
        if (wishlistData.updatedAt) {
          try {
            updatedAtDate = wishlistData.updatedAt.toDate();
          } catch (dateError) {
            console.error('Error converting updatedAt date:', dateError);
            // Keep as null
          }
        }
        
        wishlists.push({
          id: doc.id,
          name: wishlistData.name || 'Unnamed Wishlist',
          description: wishlistData.description || '',
          itemCount: wishlistData.itemCount || 0,
          creator: creatorData,
          items,
          createdAt: createdAtDate,
          updatedAt: updatedAtDate
        });
      } catch (wishlistError) {
        console.error('Error processing wishlist:', wishlistError);
        // Skip this wishlist and continue
      }
    }
    
    return res.json({ wishlists });
  } catch (error) {
    console.error('Error getting wishlists:', error);
    return res.status(500).json({ error: 'Failed to retrieve wishlists', message: error.message });
  }
};

/**
 * Get user's wishlists
 */
exports.getUserWishlists = async (req, res) => {
  try {
    // Get user ID from authenticated request
    const userId = req.user.uid;
    
    // Get all wishlists for the user
    const wishlistsSnapshot = await db.collection('wishlists')
      .where('creatorId', '==', userId)
      .orderBy('updatedAt', 'desc')
      .get();
    
    if (wishlistsSnapshot.empty) {
      return res.json({ wishlists: [] });
    }
    
    const wishlists = wishlistsSnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        description: data.description,
        isPublic: data.isPublic || false,
        itemCount: data.itemCount || 0,
        createdAt: data.createdAt ? data.createdAt.toDate() : null,
        updatedAt: data.updatedAt ? data.updatedAt.toDate() : null
      };
    });
    
    return res.json({ wishlists });
  } catch (error) {
    console.error('Error getting user wishlists:', error);
    return res.status(500).json({ error: 'Failed to retrieve user wishlists' });
  }
};

/**
 * Get wishlist by ID
 */
exports.getWishlistById = async (req, res) => {
  try {
    const { wishlistId } = req.params;
    
    // Get wishlist document
    const wishlistDoc = await db.collection('wishlists').doc(wishlistId).get();
    
    if (!wishlistDoc.exists) {
      return res.status(404).json({ error: 'Wishlist not found' });
    }
    
    const wishlistData = wishlistDoc.data();
    
    // Check if wishlist is public or belongs to the user
    if (!wishlistData.isPublic && (!req.user || req.user.uid !== wishlistData.creatorId)) {
      return res.status(403).json({ error: 'You do not have permission to view this wishlist' });
    }
    
    // Get creator info
    let creatorData = null;
    if (wishlistData.creatorId) {
      const creatorDoc = await db.collection('users').doc(wishlistData.creatorId).get();
      if (creatorDoc.exists) {
        creatorData = {
          id: creatorDoc.id,
          name: creatorDoc.data().username || creatorDoc.data().displayName,
          avatar: creatorDoc.data().photoURL || null
        };
      }
    }
    
    // Get items in the wishlist
    const itemsSnapshot = await db.collection('wishlists')
      .doc(wishlistId)
      .collection('items')
      .orderBy('addedAt', 'desc')
      .get();
    
    const items = [];
    
    for (const itemDoc of itemsSnapshot.docs) {
      const itemData = itemDoc.data();
      
      // Get agent info
      let agentData = null;
      if (itemData.agentId) {
        const agentDoc = await db.collection('agents').doc(itemData.agentId).get();
        if (agentDoc.exists) {
          const agent = agentDoc.data();
          agentData = {
            id: agentDoc.id,
            title: agent.title || agent.name,
            description: agent.description,
            imageUrl: agent.imageUrl || null,
            price: agent.price,
            creator: agent.creator || {
              name: 'Unknown Creator'
            },
            rating: agent.rating
          };
        }
      }
      
      items.push({
        id: itemDoc.id,
        agentId: itemData.agentId,
        addedAt: itemData.addedAt ? itemData.addedAt.toDate() : null,
        ...agentData
      });
    }
    
    const wishlist = {
      id: wishlistDoc.id,
      name: wishlistData.name,
      description: wishlistData.description,
      isPublic: wishlistData.isPublic || false,
      itemCount: wishlistData.itemCount || 0,
      creator: creatorData,
      items,
      createdAt: wishlistData.createdAt ? wishlistData.createdAt.toDate() : null,
      updatedAt: wishlistData.updatedAt ? wishlistData.updatedAt.toDate() : null
    };
    
    return res.json({ wishlist });
  } catch (error) {
    console.error('Error getting wishlist:', error);
    return res.status(500).json({ error: 'Failed to retrieve wishlist' });
  }
};

/**
 * Create a new wishlist
 */
exports.createWishlist = async (req, res) => {
  try {
    // Get user ID from authenticated request
    const userId = req.user.uid;
    
    const { name, description, isPublic = false } = req.body;
    
    // Validate required fields
    if (!name) {
      return res.status(400).json({ error: 'Wishlist name is required' });
    }
    
    // Create new wishlist
    const wishlistData = {
      name,
      description: description || '',
      creatorId: userId,
      isPublic: Boolean(isPublic),
      itemCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const wishlistRef = await db.collection('wishlists').add(wishlistData);
    
    return res.status(201).json({
      id: wishlistRef.id,
      ...wishlistData,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  } catch (error) {
    console.error('Error creating wishlist:', error);
    return res.status(500).json({ error: 'Failed to create wishlist' });
  }
};

/**
 * Update a wishlist
 */
exports.updateWishlist = async (req, res) => {
  try {
    // Get user ID from authenticated request
    const userId = req.user.uid;
    
    const { wishlistId } = req.params;
    const { name, description, isPublic } = req.body;
    
    // Get wishlist document
    const wishlistDoc = await db.collection('wishlists').doc(wishlistId).get();
    
    if (!wishlistDoc.exists) {
      return res.status(404).json({ error: 'Wishlist not found' });
    }
    
    const wishlistData = wishlistDoc.data();
    
    // Check if user owns the wishlist
    if (wishlistData.creatorId !== userId) {
      return res.status(403).json({ error: 'You do not have permission to update this wishlist' });
    }
    
    // Prepare update data
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (isPublic !== undefined) updateData.isPublic = Boolean(isPublic);
    
    // Update wishlist
    await db.collection('wishlists').doc(wishlistId).update(updateData);
    
    // Get updated wishlist
    const updatedWishlistDoc = await db.collection('wishlists').doc(wishlistId).get();
    const updatedWishlistData = updatedWishlistDoc.data();
    
    return res.json({
      id: wishlistId,
      ...updatedWishlistData,
      createdAt: updatedWishlistData.createdAt ? updatedWishlistData.createdAt.toDate() : null,
      updatedAt: updatedWishlistData.updatedAt ? updatedWishlistData.updatedAt.toDate() : null
    });
  } catch (error) {
    console.error('Error updating wishlist:', error);
    return res.status(500).json({ error: 'Failed to update wishlist' });
  }
};

/**
 * Delete a wishlist
 */
exports.deleteWishlist = async (req, res) => {
  try {
    // Get user ID from authenticated request
    const userId = req.user.uid;
    
    const { wishlistId } = req.params;
    
    // Get wishlist document
    const wishlistDoc = await db.collection('wishlists').doc(wishlistId).get();
    
    if (!wishlistDoc.exists) {
      return res.status(404).json({ error: 'Wishlist not found' });
    }
    
    const wishlistData = wishlistDoc.data();
    
    // Check if user owns the wishlist
    if (wishlistData.creatorId !== userId) {
      return res.status(403).json({ error: 'You do not have permission to delete this wishlist' });
    }
    
    // Delete all items in the wishlist
    const itemsSnapshot = await db.collection('wishlists').doc(wishlistId).collection('items').get();
    
    const batch = db.batch();
    
    itemsSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    // Delete the wishlist document
    batch.delete(db.collection('wishlists').doc(wishlistId));
    
    // Commit the batch
    await batch.commit();
    
    return res.json({ message: 'Wishlist deleted successfully' });
  } catch (error) {
    console.error('Error deleting wishlist:', error);
    return res.status(500).json({ error: 'Failed to delete wishlist' });
  }
};

/**
 * Toggle agent in wishlist
 */
exports.toggleWishlistItem = async (req, res) => {
  try {
    // Get user ID from authenticated request
    const userId = req.user.uid;
    
    const { agentId } = req.body;
    
    // Validate required fields
    if (!agentId) {
      return res.status(400).json({ error: 'Agent ID is required' });
    }
    
    // Check if agent exists
    const agentDoc = await db.collection('agents').doc(agentId).get();
    
    if (!agentDoc.exists) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Get or create default wishlist for user
    let defaultWishlistId;
    const defaultWishlistQuery = await db.collection('wishlists')
      .where('creatorId', '==', userId)
      .where('isDefault', '==', true)
      .limit(1)
      .get();
    
    if (defaultWishlistQuery.empty) {
      // Create default wishlist
      const defaultWishlistData = {
        name: 'My Wishlist',
        description: 'My default wishlist',
        creatorId: userId,
        isPublic: false,
        isDefault: true,
        itemCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };
      
      const defaultWishlistRef = await db.collection('wishlists').add(defaultWishlistData);
      defaultWishlistId = defaultWishlistRef.id;
    } else {
      defaultWishlistId = defaultWishlistQuery.docs[0].id;
    }
    
    // Check if agent is already in the wishlist
    const itemQuery = await db.collection('wishlists')
      .doc(defaultWishlistId)
      .collection('items')
      .where('agentId', '==', agentId)
      .limit(1)
      .get();
    
    if (itemQuery.empty) {
      // Add agent to wishlist
      await db.collection('wishlists').doc(defaultWishlistId).collection('items').add({
        agentId,
        addedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      // Increment item count
      await db.collection('wishlists').doc(defaultWishlistId).update({
        itemCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return res.json({
        added: true,
        wishlistId: defaultWishlistId,
        message: 'Agent added to wishlist'
      });
    } else {
      // Remove agent from wishlist
      await db.collection('wishlists').doc(defaultWishlistId).collection('items').doc(itemQuery.docs[0].id).delete();
      
      // Decrement item count
      await db.collection('wishlists').doc(defaultWishlistId).update({
        itemCount: admin.firestore.FieldValue.increment(-1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      
      return res.json({
        added: false,
        wishlistId: defaultWishlistId,
        message: 'Agent removed from wishlist'
      });
    }
  } catch (error) {
    console.error('Error toggling wishlist item:', error);
    return res.status(500).json({ error: 'Failed to toggle wishlist item' });
  }
};

/**
 * Check if agent is in user's wishlist
 */
exports.checkWishlistItem = async (req, res) => {
  try {
    // If not authenticated, return false
    if (!req.user) {
      return res.json({ isWishlisted: false });
    }
    
    const userId = req.user.uid;
    const { agentId } = req.params;
    
    // Validate required fields
    if (!agentId) {
      return res.status(400).json({ error: 'Agent ID is required' });
    }
    
    // Get default wishlist for user
    const defaultWishlistQuery = await db.collection('wishlists')
      .where('creatorId', '==', userId)
      .where('isDefault', '==', true)
      .limit(1)
      .get();
    
    if (defaultWishlistQuery.empty) {
      return res.json({ isWishlisted: false });
    }
    
    const defaultWishlistId = defaultWishlistQuery.docs[0].id;
    
    // Check if agent is in the wishlist
    const itemQuery = await db.collection('wishlists')
      .doc(defaultWishlistId)
      .collection('items')
      .where('agentId', '==', agentId)
      .limit(1)
      .get();
    
    return res.json({
      isWishlisted: !itemQuery.empty,
      wishlistId: defaultWishlistId
    });
  } catch (error) {
    console.error('Error checking wishlist item:', error);
    return res.status(500).json({ error: 'Failed to check wishlist item' });
  }
}; 