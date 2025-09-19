// backend/routes/agent.js
const express = require('express');
const router = express.Router();
const agentsController = require('../../controllers/agent/agentsController');
const priceController = require('../../controllers/agent/priceController');
const validateFirebaseToken = require('../../middleware/authenticationMiddleware').validateFirebaseToken;
const publicCacheMiddleware = require('../../middleware/publicCacheMiddleware');
const upload = require('../../middleware/upload');

// Log that this file is being loaded
console.log('Loading agent.js routes file with proper imports');

// Debug - print available controller methods
console.log('combinedUpdate direct check:', typeof agentsController.combinedUpdate === 'function');
console.log('createAgentWithPrice direct check:', typeof agentsController.createAgentWithPrice === 'function');
console.log('validateFirebaseToken type:', typeof validateFirebaseToken);
console.log('publicCacheMiddleware type:', typeof publicCacheMiddleware);

// Create a safe wrapper for controller methods
const safeHandler = (controllerFn, name) => {
  return async function(req, res, next) {
    console.log(`Safe handler called for: ${name}`);
    if (typeof controllerFn === 'function') {
      try {
        // Use await to ensure the controller function completes
        const result = await controllerFn(req, res, next);
        
        // If the response has already been sent, don't try to send it again
        if (res.headersSent) {
          console.log(`Response already sent from ${name}`);
          return;
        }
        
        // Otherwise, return the result
        return result;
      } catch (error) {
        console.error(`Error executing ${name}:`, error);
        
        // If the response has already been sent, don't try to send it again
        if (res.headersSent) {
          console.log(`Response already sent from ${name} despite error`);
          return;
        }
        
        return res.status(500).json({
          success: false,
          message: `Server error in ${name}`,
          error: error.message
        });
      }
    } else {
      console.error(`Handler function '${name}' is not defined`);
      
      // If the response has already been sent, don't try to send it again
      if (res.headersSent) {
        console.log(`Response already sent despite missing handler ${name}`);
        return;
      }
      
      return res.status(500).json({
        success: false,
        message: 'Server configuration error',
        error: `The '${name}' function is not available`
      });
    }
  };
};

/**
 * @swagger
 * /api/agent/test:
 *   get:
 *     summary: Test agent route
 *     description: Test endpoint to verify agent routes are working
 *     tags: [Individual Agent]
 *     responses:
 *       200:
 *         description: Test successful
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
 *                   example: "Agent test route working correctly"
 *       500:
 *         description: Internal server error
 */
router.get('/test', (req, res) => {
  console.log('Agent test route hit');
  return res.status(200).json({
    success: true,
    message: 'Agent test route working correctly'
  });
});

/**
 * @swagger
 * /api/agent/with-price:
 *   post:
 *     summary: Create agent with price
 *     description: Create a new agent with pricing information in a single operation
 *     tags: [Individual Agent]
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
 *               - price
 *             properties:
 *               title:
 *                 type: string
 *                 description: Agent title
 *                 example: "AI Writing Assistant"
 *               description:
 *                 type: string
 *                 description: Agent description
 *                 example: "An AI-powered writing assistant that helps create content"
 *               price:
 *                 type: number
 *                 description: Agent price
 *                 example: 9.99
 *               currency:
 *                 type: string
 *                 description: Currency code
 *                 example: "USD"
 *               category:
 *                 type: string
 *                 description: Agent category
 *                 example: "Writing"
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags
 *                 example: "writing,ai,content"
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Agent image
 *               icon:
 *                 type: string
 *                 format: binary
 *                 description: Agent icon
 *               jsonFile:
 *                 type: string
 *                 format: binary
 *                 description: Agent configuration JSON file
 *     responses:
 *       201:
 *         description: Agent created successfully with price
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Agent'
 *                 price:
 *                   $ref: '#/components/schemas/AgentPrice'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       500:
 *         description: Internal server error
 */
router.post('/with-price', validateFirebaseToken, safeHandler(agentsController.createAgentWithPrice, 'createAgentWithPrice'));

/**
 * @swagger
 * /api/agent/{id}/combined-update:
 *   post:
 *     summary: Combined update (POST)
 *     description: Update agent and price information in a single operation using POST method
 *     tags: [Individual Agent]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *         example: "agent-123"
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: Agent title
 *                 example: "Updated AI Writing Assistant"
 *               description:
 *                 type: string
 *                 description: Agent description
 *               price:
 *                 type: number
 *                 description: Agent price
 *                 example: 12.99
 *               currency:
 *                 type: string
 *                 description: Currency code
 *                 example: "USD"
 *               category:
 *                 type: string
 *                 description: Agent category
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Agent image
 *               icon:
 *                 type: string
 *                 format: binary
 *                 description: Agent icon
 *               jsonFile:
 *                 type: string
 *                 format: binary
 *                 description: Agent configuration JSON file
 *     responses:
 *       200:
 *         description: Agent and price updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Agent'
 *                 price:
 *                   $ref: '#/components/schemas/AgentPrice'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Internal server error
 *   put:
 *     summary: Combined update (PUT)
 *     description: Update agent and price information in a single operation using PUT method
 *     tags: [Individual Agent]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *         example: "agent-123"
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: Agent title
 *                 example: "Updated AI Writing Assistant"
 *               description:
 *                 type: string
 *                 description: Agent description
 *               price:
 *                 type: number
 *                 description: Agent price
 *                 example: 12.99
 *               currency:
 *                 type: string
 *                 description: Currency code
 *                 example: "USD"
 *               category:
 *                 type: string
 *                 description: Agent category
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Agent image
 *               icon:
 *                 type: string
 *                 format: binary
 *                 description: Agent icon
 *               jsonFile:
 *                 type: string
 *                 format: binary
 *                 description: Agent configuration JSON file
 *     responses:
 *       200:
 *         description: Agent and price updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Agent'
 *                 price:
 *                   $ref: '#/components/schemas/AgentPrice'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Internal server error
 */
router.post('/:id/combined-update', (req, res, next) => {
  console.log('Combined update route hit with POST method');
  return next();
}, validateFirebaseToken, safeHandler(agentsController.combinedUpdate, 'combinedUpdate'));

router.put('/:id/combined-update', (req, res, next) => {
  console.log('Combined update route hit with PUT method');
  return next();
}, validateFirebaseToken, safeHandler(agentsController.combinedUpdate, 'combinedUpdate'));

/**
 * @swagger
 * /api/agent:
 *   post:
 *     summary: Create new agent
 *     description: Create a new AI agent (authentication required)
 *     tags: [Individual Agent]
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
 *                 description: Agent title
 *                 example: "AI Writing Assistant"
 *               description:
 *                 type: string
 *                 description: Agent description
 *                 example: "An AI-powered writing assistant that helps create content"
 *               category:
 *                 type: string
 *                 description: Agent category
 *                 example: "Writing"
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags
 *                 example: "writing,ai,content"
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Agent image
 *               icon:
 *                 type: string
 *                 format: binary
 *                 description: Agent icon
 *               jsonFile:
 *                 type: string
 *                 format: binary
 *                 description: Agent configuration JSON file
 *               isPublished:
 *                 type: boolean
 *                 description: Whether the agent is published
 *                 default: false
 *     responses:
 *       201:
 *         description: Agent created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Agent'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       500:
 *         description: Internal server error
 */
router.post('/', validateFirebaseToken, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'jsonFile', maxCount: 1 }
]), safeHandler(agentsController.createAgent, 'createAgent'));

/**
 * @swagger
 * /api/agent/{id}:
 *   get:
 *     summary: Get agent by ID
 *     description: Retrieve a specific agent by its ID
 *     tags: [Individual Agent]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *         example: "agent-123"
 *     responses:
 *       200:
 *         description: Agent retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Agent'
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Internal server error
 *   put:
 *     summary: Update agent
 *     description: Update an existing agent (authentication required)
 *     tags: [Individual Agent]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *         example: "agent-123"
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: Agent title
 *                 example: "Updated AI Writing Assistant"
 *               description:
 *                 type: string
 *                 description: Agent description
 *               category:
 *                 type: string
 *                 description: Agent category
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Agent image
 *               icon:
 *                 type: string
 *                 format: binary
 *                 description: Agent icon
 *               jsonFile:
 *                 type: string
 *                 format: binary
 *                 description: Agent configuration JSON file
 *               isPublished:
 *                 type: boolean
 *                 description: Whether the agent is published
 *     responses:
 *       200:
 *         description: Agent updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Agent'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Internal server error
 *   patch:
 *     summary: Partial update agent
 *     description: Partially update an existing agent (authentication required)
 *     tags: [Individual Agent]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *         example: "agent-123"
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: Agent title
 *               description:
 *                 type: string
 *                 description: Agent description
 *               category:
 *                 type: string
 *                 description: Agent category
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags
 *               image:
 *                 type: string
 *                 format: binary
 *                 description: Agent image
 *               icon:
 *                 type: string
 *                 format: binary
 *                 description: Agent icon
 *               jsonFile:
 *                 type: string
 *                 format: binary
 *                 description: Agent configuration JSON file
 *               isPublished:
 *                 type: boolean
 *                 description: Whether the agent is published
 *     responses:
 *       200:
 *         description: Agent updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Agent'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Internal server error
 *   delete:
 *     summary: Delete agent
 *     description: Delete an agent (authentication required)
 *     tags: [Individual Agent]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *         example: "agent-123"
 *     responses:
 *       200:
 *         description: Agent deleted successfully
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
 *                   example: "Agent deleted successfully"
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id', publicCacheMiddleware({ maxAge: 600 }), safeHandler(agentsController.getAgentById, 'getAgentById'));
router.put('/:id', validateFirebaseToken, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'jsonFile', maxCount: 1 }
]), safeHandler(agentsController.updateAgent, 'updateAgent'));
router.patch('/:id', validateFirebaseToken, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'icon', maxCount: 1 },
  { name: 'jsonFile', maxCount: 1 }
]), safeHandler(agentsController.updateAgent, 'updateAgent'));
router.delete('/:id', validateFirebaseToken, safeHandler(agentsController.deleteAgent, 'deleteAgent'));

/**
 * @swagger
 * /api/agent/{id}:
 *   post:
 *     summary: Update agent (POST)
 *     description: Update an existing agent using POST method (authentication required)
 *     tags: [Individual Agent]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *         example: "agent-123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 description: Agent title
 *                 example: "Updated AI Writing Assistant"
 *               description:
 *                 type: string
 *                 description: Agent description
 *               category:
 *                 type: string
 *                 description: Agent category
 *               tags:
 *                 type: string
 *                 description: Comma-separated tags
 *               isPublished:
 *                 type: boolean
 *                 description: Whether the agent is published
 *     responses:
 *       200:
 *         description: Agent updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Agent'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Internal server error
 */
router.post('/:id', validateFirebaseToken, safeHandler(agentsController.updateAgent, 'updateAgent'));

/**
 * @swagger
 * /api/agent/{id}/price:
 *   get:
 *     summary: Get agent price
 *     description: Retrieve pricing information for a specific agent
 *     tags: [Individual Agent]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *         example: "agent-123"
 *     responses:
 *       200:
 *         description: Agent price retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/AgentPrice'
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Internal server error
 *   post:
 *     summary: Update agent price
 *     description: Update pricing information for a specific agent (authentication required)
 *     tags: [Individual Agent]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *         example: "agent-123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - price
 *             properties:
 *               price:
 *                 type: number
 *                 description: Agent price
 *                 example: 9.99
 *               currency:
 *                 type: string
 *                 description: Currency code
 *                 example: "USD"
 *               discount:
 *                 type: number
 *                 description: Discount percentage
 *                 example: 10
 *               isFree:
 *                 type: boolean
 *                 description: Whether the agent is free
 *                 example: false
 *     responses:
 *       200:
 *         description: Agent price updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/AgentPrice'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Internal server error
 *   put:
 *     summary: Update agent price (PUT)
 *     description: Update pricing information for a specific agent using PUT method (authentication required)
 *     tags: [Individual Agent]
 *     security:
 *       - FirebaseAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Agent ID
 *         example: "agent-123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - price
 *             properties:
 *               price:
 *                 type: number
 *                 description: Agent price
 *                 example: 9.99
 *               currency:
 *                 type: string
 *                 description: Currency code
 *                 example: "USD"
 *               discount:
 *                 type: number
 *                 description: Discount percentage
 *                 example: 10
 *               isFree:
 *                 type: boolean
 *                 description: Whether the agent is free
 *                 example: false
 *     responses:
 *       200:
 *         description: Agent price updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/AgentPrice'
 *       400:
 *         description: Bad request - Invalid input data
 *       401:
 *         description: Unauthorized - Authentication required
 *       404:
 *         description: Agent not found
 *       500:
 *         description: Internal server error
 */
router.get('/:id/price', publicCacheMiddleware({ maxAge: 300 }), safeHandler(priceController.getAgentPrice, 'getAgentPrice'));
router.post('/:id/price', validateFirebaseToken, safeHandler(priceController.updateAgentPrice, 'updateAgentPrice'));
router.put('/:id/price', validateFirebaseToken, safeHandler(priceController.updateAgentPrice, 'updateAgentPrice'));

module.exports = router; 