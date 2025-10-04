const express = require('express');
const router = express.Router();
const admin = require('firebase-admin');
const { auth } = require('../../middleware/authenticationMiddleware');
const upload = require('../../middleware/upload');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Collection reference - AI Tools only (exactly as before)
const COLLECTION_NAME = 'ai_tools';

/**
 * @swagger
 * /api/ai-tools:
 *   get:
 *     summary: Get all AI tools
 *     description: Retrieve a list of all AI tools available in the system
 *     tags: [AI Tools]
 *     parameters:
 *       - in: query
 *         name: category
 *         schema:
 *           type: string
 *         description: Filter by category
 *         example: "Development"
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search term for tool title and description
 *         example: "code generator"
 *       - in: query
 *         name: tags
 *         schema:
 *           type: string
 *         description: Comma-separated list of tags to filter by
 *         example: "development,coding"
 *     responses:
 *       200:
 *         description: AI tools retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 count:
 *                   type: integer
 *                   example: 25
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AITool'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 * @swagger
 * /api/ai-tools/{id}:
 *   get:
 *     summary: Get AI tool by ID
 *     description: Get a single AI tool by its ID
 *     tags: [AI Tools]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: AI tool ID
 *         example: "tool-123"
 *     responses:
 *       200:
 *         description: AI tool retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/AITool'
 *       400:
 *         description: Bad request - Invalid ID
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "Invalid ID provided"
 *       404:
 *         description: AI tool not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 error:
 *                   type: string
 *                   example: "AI tool with ID tool-123 not found"
 *       500:
 *         description: Internal server error
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
 * @swagger
 * /api/ai-tools:
 *   post:
 *     summary: Create new AI tool
 *     description: Create a new AI tool (Admin only)
 *     tags: [AI Tools]
 *     security:
 *       - FirebaseAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *             properties:
 *               title:
 *                 type: string
 *                 description: AI tool title
 *                 example: "Code Generator"
 *               description:
 *                 type: string
 *                 description: AI tool description
 *                 example: "An AI-powered code generation tool"
 *               link:
 *                 type: string
 *                 description: Tool URL
 *                 example: "https://example.com/tool"
 *               keywords:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Keywords (array of strings)
 *                 example: ["coding", "development", "ai"]
 *               category:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Tool categories (array of strings)
 *                 example: ["Productivity", "AI Tools"]
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags
 *                 example: "ai,coding,productivity"
 *               additionalHTML:
 *                 type: string
 *                 description: Additional HTML content
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Tool image
 *     responses:
 *       201:
 *         description: AI tool created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/AITool'
 *       400:
 *         description: Bad request - Missing required fields
 *       403:
 *         description: Forbidden - Admin privileges required
 *       500:
 *         description: Internal server error
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
    const { title, description, link, keyword, keywords, category, additionalHTML } = req.body;
    
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
    let processedKeywords = [];
    const keywordsInput = keywords || keyword; // Support both 'keywords' and 'keyword' for backward compatibility
    if (keywordsInput) {
      if (Array.isArray(keywordsInput)) {
        processedKeywords = keywordsInput;
      } else if (typeof keywordsInput === 'string') {
        // If it's a comma-separated string, split it
        if (keywordsInput.includes(',')) {
          processedKeywords = keywordsInput.split(',').map(kw => kw.trim());
        } else {
          processedKeywords = [keywordsInput];
        }
      }
    }
    
    // Handle category which might be a string, array, or missing
    let processedCategory = [];
    if (category) {
      if (Array.isArray(category)) {
        processedCategory = category;
      } else if (typeof category === 'string') {
        // If it's a comma-separated string, split it
        if (category.includes(',')) {
          processedCategory = category.split(',').map(cat => cat.trim());
        } else {
          processedCategory = [category];
        }
      }
    }
    
    // Debug logging
    console.log('Extracted fields:');
    console.log('Title:', title);
    console.log('Description:', description);
    console.log('Link:', link);
    console.log('Keywords:', processedKeywords);
    console.log('Category:', processedCategory);
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
    
    // Get image path if uploaded (same logic as before)
    let imageUrl = '';
    if (req.file) {
      console.log('File received:', req.file.originalname, req.file.mimetype, req.file.size);
      
      const timestamp = Date.now();
      const filename = `${timestamp}-${req.file.originalname.replace(/\s+/g, '-')}`;
      
      try {
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          console.log('Using Firebase Storage bucket:', bucketName);
          
          const bucket = storage.bucket(bucketName);
          const fileName = `ai-tools/${filename}`;
          const fileRef = bucket.file(fileName);
          
          await fileRef.save(req.file.buffer, {
            metadata: {
              contentType: req.file.mimetype,
            },
          });
          
          await fileRef.makePublic();
          imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
          console.log('Firebase Storage URL:', imageUrl);
        } else {
          console.log('Firebase Storage bucket not configured. Using local storage.');
          
          const uploadsDir = path.join(__dirname, '../../uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
          imageUrl = `/uploads/${filename}`;
          console.log('Local storage URL:', imageUrl);
        }
      } catch (error) {
        console.error('Error uploading image:', error);
        
        const uploadsDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
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
      keywords: processedKeywords,  // Store as array of keywords
      tags: tags || [],
      category: processedCategory,  // Store as array of categories
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
 * @swagger
 * /api/ai-tools/{id}:
 *   put:
 *     summary: Update AI tool
 *     description: Update an existing AI tool (Admin only)
 *     tags: [AI Tools]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: AI tool ID
 *         example: "tool-123"
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: AI tool title
 *                 example: "Updated Code Generator"
 *               description:
 *                 type: string
 *                 description: AI tool description
 *                 example: "An updated AI-powered code generation tool"
 *               link:
 *                 type: string
 *                 description: Tool URL
 *                 example: "https://example.com/updated-tool"
 *               keywords:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Keywords (array of strings)
 *                 example: ["coding", "development", "ai", "updated"]
 *               category:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Tool categories (array of strings)
 *                 example: ["Productivity", "AI Tools"]
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags
 *                 example: "ai,coding,productivity,updated"
 *               additionalHTML:
 *                 type: string
 *                 description: Additional HTML content
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Tool image
 *     responses:
 *       200:
 *         description: AI tool updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/AITool'
 *       403:
 *         description: Forbidden - Admin privileges required
 *       404:
 *         description: AI tool not found
 *       500:
 *         description: Internal server error
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
    const keywordsInput = req.body.keywords || keyword; // Support both 'keywords' and 'keyword' for backward compatibility
    if (keywordsInput) {
      if (Array.isArray(keywordsInput)) {
        keywords = keywordsInput;
      } else if (typeof keywordsInput === 'string') {
        // If it's a comma-separated string, split it
        if (keywordsInput.includes(',')) {
          keywords = keywordsInput.split(',').map(kw => kw.trim());
        } else {
          keywords = [keywordsInput];
        }
      }
    }

    // Handle category which might be a string, array, or missing
    let processedCategory = undefined;
    if (category) {
      if (Array.isArray(category)) {
        processedCategory = category;
      } else if (typeof category === 'string') {
        // If it's a comma-separated string, split it
        if (category.includes(',')) {
          processedCategory = category.split(',').map(cat => cat.trim());
        } else {
          processedCategory = [category];
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
    
    // Handle image upload (same logic as POST)
    let imageUrl = undefined;
    if (req.file) {
      console.log('File received:', req.file.originalname, req.file.mimetype, req.file.size);
      
      const timestamp = Date.now();
      const filename = `${timestamp}-${req.file.originalname.replace(/\s+/g, '-')}`;
      
      try {
        const storage = admin.storage();
        const bucketName = process.env.FIREBASE_STORAGE_BUCKET;
        
        if (bucketName) {
          console.log('Using Firebase Storage bucket:', bucketName);
          
          const bucket = storage.bucket(bucketName);
          const fileName = `ai-tools/${filename}`;
          const fileRef = bucket.file(fileName);
          
          await fileRef.save(req.file.buffer, {
            metadata: {
              contentType: req.file.mimetype,
            },
          });
          
          await fileRef.makePublic();
          imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;
          console.log('Firebase Storage URL:', imageUrl);
        } else {
          console.log('Firebase Storage bucket not configured. Using local storage.');
          
          const uploadsDir = path.join(__dirname, '../../uploads');
          if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
          }
          
          fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
          imageUrl = `/uploads/${filename}`;
          console.log('Local storage URL:', imageUrl);
        }
      } catch (error) {
        console.error('Error uploading image:', error);
        
        const uploadsDir = path.join(__dirname, '../../uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        
        fs.writeFileSync(path.join(uploadsDir, filename), req.file.buffer);
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
      ...(processedCategory && { category: processedCategory }), // Store as array of categories
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
 * @swagger
 * /api/ai-tools/{id}:
 *   delete:
 *     summary: Delete AI tool
 *     description: Delete an AI tool (Admin only)
 *     tags: [AI Tools]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: AI tool ID
 *         example: "tool-123"
 *     responses:
 *       200:
 *         description: AI tool deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "AI tool tool-123 has been deleted"
 *       403:
 *         description: Forbidden - Admin privileges required
 *       404:
 *         description: AI tool not found
 *       500:
 *         description: Internal server error
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