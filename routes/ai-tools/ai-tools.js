const express = require('express');
const router = express.Router();
const admin = require('firebase-admin'); // Kept for Firebase Storage only
const { pool } = require('../../config/database');
const { auth } = require('../../middleware/authenticationMiddleware');
const upload = require('../../middleware/upload');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// ==========================================
// COLUMN MAPPING HELPERS
// ==========================================

/**
 * Maps a PostgreSQL row (snake_case) from the ai_tools table to the
 * camelCase format the AI Tools API expects.
 */
const mapRowToTool = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    link: row.link || '',
    image: row.image || '',
    keywords: row.keywords || [],
    tags: row.tags || [],
    category: parseCategory(row.category),
    additionalHTML: row.additional_html || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
};

/**
 * Parse category from DB which may be:
 *  - null/undefined → []
 *  - a plain string like "AI Art" → ["AI Art"]
 *  - a PostgreSQL array literal like '{"AI Art","Content Creation"}' → ["AI Art", "Content Creation"]
 */
function parseCategory(val) {
  if (!val) return [];
  if (typeof val === 'string' && val.startsWith('{') && val.endsWith('}')) {
    // PostgreSQL array literal – strip braces, split on comma, remove quotes
    return val.slice(1, -1)
      .match(/("(?:[^"\\]|\\.)*"|[^,]+)/g)
      ?.map(s => s.replace(/^"|"$/g, '').replace(/\\"/g, '"')) || [];
  }
  return [val];
}

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

    const result = await pool.query(
      "SELECT * FROM ai_tools WHERE 1=1 ORDER BY created_at DESC"
    );

    const tools = result.rows.map(row => mapRowToTool(row));

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

    console.log(`Attempting to fetch tool from ai_tools table with ID: ${id}`);
    const result = await pool.query(
      "SELECT * FROM ai_tools WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      console.error(`Tool with ID ${id} not found in ai_tools table`);
      return res.status(404).json({
        success: false,
        error: `AI tool with ID ${id} not found`
      });
    }

    const data = mapRowToTool(result.rows[0]);
    console.log(`Successfully retrieved tool with ID: ${id}`);
    console.log(`Tool data fields: ${Object.keys(data).join(', ')}`);

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error(`Error fetching AI tool ${req.params.id}:`, error);
    console.error('Error stack:', error.stack);

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
    // DB stores category as TEXT (single value); take the first element if array
    let processedCategory = null;
    if (category) {
      if (Array.isArray(category)) {
        processedCategory = category[0] || null;
      } else if (typeof category === 'string') {
        // If it's a comma-separated string, take the first value
        processedCategory = category.includes(',') ? category.split(',')[0].trim() : category;
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

    // Insert into ai_tools table
    const toolId = uuidv4();
    const result = await pool.query(
      `INSERT INTO ai_tools (
        id, title, description, link, image, keywords, tags,
        category, additional_html, created_by, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, NOW(), NOW()
      ) RETURNING *`,
      [
        toolId,
        title,
        description,
        safeLink,
        imageUrl || '',
        processedKeywords,   // TEXT[] - pg driver handles JS arrays
        tags || [],           // TEXT[]
        processedCategory,    // TEXT (single value)
        additionalHTML || '',
        req.user.uid
      ]
    );

    const createdTool = mapRowToTool(result.rows[0]);

    return res.status(201).json({
      success: true,
      data: createdTool
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
    // DB stores category as TEXT (single value); take the first element if array
    let processedCategory = undefined;
    if (category) {
      if (Array.isArray(category)) {
        processedCategory = category[0] || null;
      } else if (typeof category === 'string') {
        processedCategory = category.includes(',') ? category.split(',')[0].trim() : category;
      }
    }

    // Check if the tool exists
    const existingResult = await pool.query(
      "SELECT * FROM ai_tools WHERE id = $1",
      [id]
    );

    if (existingResult.rows.length === 0) {
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

    // Build dynamic UPDATE query with only the provided fields
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    if (title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      values.push(title);
    }
    if (description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (link !== undefined) {
      setClauses.push(`link = $${paramIndex++}`);
      values.push(link);
    }
    if (imageUrl !== undefined) {
      setClauses.push(`image = $${paramIndex++}`);
      values.push(imageUrl);
    }
    if (keywords !== undefined) {
      setClauses.push(`keywords = $${paramIndex++}`);
      values.push(keywords);
    }
    if (tags !== undefined) {
      setClauses.push(`tags = $${paramIndex++}`);
      values.push(tags);
    }
    if (processedCategory !== undefined) {
      setClauses.push(`category = $${paramIndex++}`);
      values.push(processedCategory);
    }
    if (additionalHTML !== undefined) {
      setClauses.push(`additional_html = $${paramIndex++}`);
      values.push(additionalHTML);
    }

    // Always set updated_at and updated_by
    setClauses.push(`updated_at = NOW()`);
    setClauses.push(`updated_by = $${paramIndex++}`);
    values.push(req.user.uid);

    // Add the WHERE clause parameter
    values.push(id);

    const updateQuery = `
      UPDATE ai_tools
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const updateResult = await pool.query(updateQuery, values);

    const updatedTool = mapRowToTool(updateResult.rows[0]);

    return res.json({
      success: true,
      data: updatedTool
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
    const existingResult = await pool.query(
      "SELECT id FROM ai_tools WHERE id = $1",
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'AI tool not found'
      });
    }

    // Delete the row
    await pool.query(
      "DELETE FROM ai_tools WHERE id = $1",
      [id]
    );

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
