const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { auth } = require('../../middleware/authenticationMiddleware');
const upload = require('../../middleware/upload');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Collection reference
const COLLECTION_NAME = 'ai_tools';

/**
 * @route   GET /api/ai-tools
 * @desc    Get all AI tools
 * @access  Public
 */
router.get('/', async (req, res) => {
  try {
    console.log('Fetching all AI tools...');
    
    // Get tools with optional filtering
    const query = admin.firestore().collection(COLLECTION_NAME)
      .orderBy('createdAt', 'desc');
    
    // Execute query
    const snapshot = await query.get();
    
    // Map the documents
    const tools = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    return res.json({
      success: true,
      count: tools.length,
      data: tools
    });
  } catch (error) {
    console.error('Error fetching AI tools:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error while fetching AI tools'
    });
  }
});

/**
 * @route   GET /api/ai-tools/:id
 * @desc    Get a single AI tool by ID
 * @access  Public
 */
router.get('/:id', async (req, res) => {
  try {
    console.log(`Fetching AI tool with ID: ${req.params.id}`);
    const id = req.params.id;
    
    if (!id) {
      console.error('Invalid ID provided:', id);
      return res.status(400).json({
        success: false,
        error: 'Invalid ID provided'
      });
    }
    
    // Get the document
    console.log(`Attempting to fetch document from collection: ${COLLECTION_NAME}, with ID: ${id}`);
    const doc = await admin.firestore().collection(COLLECTION_NAME).doc(id).get();
    
    // Check if the document exists
    if (!doc.exists) {
      console.error(`Document with ID ${id} not found in collection ${COLLECTION_NAME}`);
      return res.status(404).json({
        success: false,
        error: `AI tool with ID ${id} not found`
      });
    }
    
    // Log successful retrieval
    console.log(`Successfully retrieved document with ID: ${id}`);
    
    // Get document data
    const data = doc.data();
    console.log(`Document data fields: ${Object.keys(data).join(', ')}`);
    
    return res.json({
      success: true,
      data: {
        id: doc.id,
        ...data
      }
    });
  } catch (error) {
    console.error(`Error fetching AI tool ${req.params.id}:`, error);
    console.error('Error stack:', error.stack);
    
    // Provide more detailed error information
    return res.status(500).json({
      success: false,
      error: 'Server error while fetching AI tool',
      details: process.env.NODE_ENV === 'development' ? {
        message: error.message,
        code: error.code || 'unknown'
      } : undefined
    });
  }
});

/**
 * @route   POST /api/ai-tools
 * @desc    Create a new AI tool
 * @access  Private (Admin only)
 */
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    console.log('Creating AI tool with data:', req.body);
    
    // Check if user is admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }
    
    // Extract fields from request body
    const { title, description, link, keyword, category, additionalHTML } = req.body;
    
    // Handle tags which might be a string, array, or missing
    let tags = [];
    if (req.body.tags) {
      if (Array.isArray(req.body.tags)) {
        tags = req.body.tags;
      } else if (typeof req.body.tags === 'string') {
        // If it's a comma-separated string, split it
        if (req.body.tags.includes(',')) {
          tags = req.body.tags.split(',').map(tag => tag.trim());
        } else {
          tags = [req.body.tags];
        }
      }
    }
    
    // Handle keywords which might be a string, array, or missing
    let keywords = [];
    if (keyword) {
      if (Array.isArray(keyword)) {
        keywords = keyword;
      } else if (typeof keyword === 'string') {
        // If it's a comma-separated string, split it
        if (keyword.includes(',')) {
          keywords = keyword.split(',').map(kw => kw.trim());
        } else {
          keywords = [keyword];
        }
      }
    }
    
    // Debug logging
    console.log('Extracted fields:');
    console.log('Title:', title);
    console.log('Description:', description);
    console.log('Link:', link);
    console.log('Keyword:', keyword);
    console.log('Category:', category);
    console.log('Additional HTML:', additionalHTML);
    console.log('Tags:', tags);
    console.log('Image file:', req.file);
    
    // Validate required fields
    if (!title || !description) {
      return res.status(400).json({
        success: false,
        error: 'Title and description are required fields'
      });
    }
    
    // Ensure link has a default value if empty
    const safeLink = link || '';
    
    // Get image path if uploaded
    let imageUrl = '';
    if (req.file) {
      console.log('File received:', req.file.originalname, req.file.mimetype, req.file.size);
      
      // Generate a unique filename
      const timestamp = Date.now();
      const filename = `${timestamp}-${req.file.originalname.replace(/\s+/g, '-')}`;
      
      try {
        // Try Firebase Storage first
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          console.log('Using Firebase Storage bucket:', bucketName);
          
          const bucket = storage.bucket(bucketName);
          
          // Create a file reference
          const fileName = `ai-tools/${filename}`;
          const fileRef = bucket.file(fileName);
          
          // Upload file
          await fileRef.save(req.file.buffer, {
            metadata: {
              contentType: req.file.mimetype,
            },
          });
          
          // Make file public
          await fileRef.makePublic();
          
          // Get public URL
          imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
          console.log('Firebase Storage URL:', imageUrl);
        } else {
          // Fallback to local storage
          console.log('Firebase Storage bucket not configured. Using local storage.');
          
          // Ensure uploads directory exists
          const uploadsDir = path.join(__dirname, '../../uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          // Save file locally
          fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
          
          // Set the URL to the local path
          imageUrl = `/uploads/${filename}`;
          console.log('Local storage URL:', imageUrl);
        }
      } catch (error) {
        console.error('Error uploading image:', error);
        
        // Fallback to local storage on error
        console.log('Falling back to local storage');
        
        // Ensure uploads directory exists
        const uploadsDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        // Save file locally
        fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
        
        // Set the URL to the local path
        imageUrl = `/uploads/${filename}`;
        console.log('Local storage URL:', imageUrl);
      }
    }
    
    // Prepare the document
    const newTool = {
      title,
      description,
      link: safeLink,
      image: imageUrl || '',
      keywords: keywords || [],  // Store as array of keywords
      tags: tags || [],
      category: category || '',
      additionalHTML: additionalHTML || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: req.user.uid
    };
    
    // Add the document
    const docRef = await admin.firestore().collection(COLLECTION_NAME).add(newTool);
    
    // Get the created document
    const createdDoc = await docRef.get();
    
    return res.status(201).json({
      success: true,
      data: {
        id: docRef.id,
        ...createdDoc.data()
      }
    });
  } catch (error) {
    console.error('Error creating AI tool:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error while creating AI tool'
    });
  }
});

/**
 * @route   PUT /api/ai-tools/:id
 * @desc    Update an AI tool
 * @access  Private (Admin only)
 */
router.put('/:id', auth, upload.single('image'), async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }
    
    const id = req.params.id;
    const { title, description, link, keyword, category, additionalHTML } = req.body;
    
    // Handle tags which might be a string, array, or missing
    let tags = undefined;
    if (req.body.tags) {
      if (Array.isArray(req.body.tags)) {
        tags = req.body.tags;
      } else if (typeof req.body.tags === 'string') {
        // If it's a comma-separated string, split it
        if (req.body.tags.includes(',')) {
          tags = req.body.tags.split(',').map(tag => tag.trim());
        } else {
          tags = [req.body.tags];
        }
      }
    }
    
    // Handle keywords which might be a string, array, or missing
    let keywords = undefined;
    if (keyword) {
      if (Array.isArray(keyword)) {
        keywords = keyword;
      } else if (typeof keyword === 'string') {
        // If it's a comma-separated string, split it
        if (keyword.includes(',')) {
          keywords = keyword.split(',').map(kw => kw.trim());
        } else {
          keywords = [keyword];
        }
      }
    }
    
    // Check if the tool exists
    const toolRef = admin.firestore().collection(COLLECTION_NAME).doc(id);
    const doc = await toolRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'AI tool not found'
      });
    }
    
    // Get image URL if uploaded
    let imageUrl = undefined;
    if (req.file) {
      console.log('File received:', req.file.originalname, req.file.mimetype, req.file.size);
      
      // Generate a unique filename
      const timestamp = Date.now();
      const filename = `${timestamp}-${req.file.originalname.replace(/\s+/g, '-')}`;
      
      try {
        // Try Firebase Storage first
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          console.log('Using Firebase Storage bucket:', bucketName);
          
          const bucket = storage.bucket(bucketName);
          
          // Create a file reference
          const fileName = `ai-tools/${filename}`;
          const fileRef = bucket.file(fileName);
          
          // Upload file
          await fileRef.save(req.file.buffer, {
            metadata: {
              contentType: req.file.mimetype,
            },
          });
          
          // Make file public
          await fileRef.makePublic();
          
          // Get public URL
          imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
          console.log('Firebase Storage URL:', imageUrl);
        } else {
          // Fallback to local storage
          console.log('Firebase Storage bucket not configured. Using local storage.');
          
          // Ensure uploads directory exists
          const uploadsDir = path.join(__dirname, '../../uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          // Save file locally
          fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
          
          // Set the URL to the local path
          imageUrl = `/uploads/${filename}`;
          console.log('Local storage URL:', imageUrl);
        }
      } catch (error) {
        console.error('Error uploading image:', error);
        
        // Fallback to local storage on error
        console.log('Falling back to local storage');
        
        // Ensure uploads directory exists
        const uploadsDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        // Save file locally
        fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
        
        // Set the URL to the local path
        imageUrl = `/uploads/${filename}`;
        console.log('Local storage URL:', imageUrl);
      }
    }
    
    // Prepare the update data
    const updateData = {
      ...(title && { title }),
      ...(description && { description }),
      ...(link && { link }),
      ...(imageUrl && { image: imageUrl }),
      ...(keywords && { keywords }),  // Store as array of keywords
      ...(tags && { tags }),
      ...(category && { category }),
      ...(additionalHTML && { additionalHTML }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedBy: req.user.uid
    };
    
    // Update the document
    await toolRef.update(updateData);
    
    // Get the updated document
    const updatedDoc = await toolRef.get();
    
    return res.json({
      success: true,
      data: {
        id: updatedDoc.id,
        ...updatedDoc.data()
      }
    });
  } catch (error) {
    console.error(`Error updating AI tool ${req.params.id}:`, error);
    return res.status(500).json({
      success: false,
      error: 'Server error while updating AI tool'
    });
  }
});

/**
 * @route   DELETE /api/ai-tools/:id
 * @desc    Delete an AI tool
 * @access  Private (Admin only)
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Access denied. Admin privileges required.'
      });
    }
    
    const id = req.params.id;
    
    // Check if the tool exists
    const toolRef = admin.firestore().collection(COLLECTION_NAME).doc(id);
    const doc = await toolRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({
        success: false,
        error: 'AI tool not found'
      });
    }
    
    // Delete the document
    await toolRef.delete();
    
    return res.json({
      success: true,
      message: `AI tool ${id} has been deleted`
    });
  } catch (error) {
    console.error(`Error deleting AI tool ${req.params.id}:`, error);
    return res.status(500).json({
      success: false,
      error: 'Server error while deleting AI tool'
    });
  }
});

module.exports = router; 