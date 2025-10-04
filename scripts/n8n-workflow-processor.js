const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');

// Initialize Firebase
require('../config/firebase.js');

const db = admin.firestore();
const bucket = admin.storage().bucket('aiwaverider.firebasestorage.app');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configuration
const CONFIG = {
  N8N_WORKFLOWS_PATH: 'E:\\N8N\\n8n-master-workflows',
  COLLECTION_NAME: 'agents',
  TEST_MODE: false, // Process all agents
  OPENAI_MODEL: 'gpt-4o-mini',
  MAX_COST_LIMIT: 100, // $100 limit for full processing
  DELAY_BETWEEN_CALLS: 1000
};

let totalCost = 0;
let apiCallCount = 0;
let existingAgents = new Set(); // Track existing agent IDs

/**
 * Load existing agents from Firebase to check for duplicates
 */
async function loadExistingAgents() {
  try {
    console.log('🔍 Loading existing agents to check for duplicates...');
    const snapshot = await db.collection(CONFIG.COLLECTION_NAME).get();
    
    snapshot.forEach(doc => {
      existingAgents.add(doc.id);
    });
    
    console.log(`✅ Found ${existingAgents.size} existing agents in database`);
    return true;
  } catch (error) {
    console.error('❌ Error loading existing agents:', error);
    return false;
  }
}

/**
 * Get folder-based category from file path
 */
function getFolderCategory(filePath) {
  // Extract folder name from path like: E:\N8N\n8n-master-workflows\WhatsApp\file.json
  const pathParts = filePath.split('\\');
  const folderName = pathParts[pathParts.length - 2]; // Get the folder name
  
  // Map folder names to category names
  const folderCategoryMap = {
    'AI': 'AI',
    'Airtable': 'Airtable',
    'AI_Chatbot': 'AI Chatbot',
    'AI_RAG': 'AI RAG',
    'AI_Research_RAG_and_Data_Analysis': 'AI Research',
    'AI_Summarization': 'AI Summarization',
    'Building_Blocks': 'Building Blocks',
    'Content_Creation': 'Content Creation',
    'CRM': 'CRM',
    'Crypto_Trading': 'Crypto Trading',
    'Database_and_Storage': 'Database & Storage',
    'Design': 'Design',
    'DevOps': 'DevOps',
    'Discord': 'Discord',
    'Document_Extraction': 'Document Extraction',
    'Engineering': 'Engineering',
    'Finance': 'Finance',
    'Forms_and_Surveys': 'Forms & Surveys',
    'Gmail_and_Email_Automation': 'Email Automation',
    'Google_Drive_and_Google_Sheets': 'Google Workspace',
    'HR': 'HR',
    'HR_and_Recruitment': 'HR & Recruitment',
    'Instagram_Twitter_Social_Media': 'Social Media',
    'Internal_Wiki': 'Internal Wiki',
    'Invoice_Processing': 'Invoice Processing',
    'IT_Ops': 'IT Operations',
    'Lead_Generation': 'Lead Generation',
    'Lead_Nurturing': 'Lead Nurturing',
    'Marketing': 'Marketing',
    'Market_Research': 'Market Research',
    'Miscellaneous': 'Miscellaneous',
    'Multimodal_AI': 'Multimodal AI',
    'Notion': 'Notion',
    'OpenAI_and_LLMs': 'OpenAI & LLMs',
    'Other': 'Other',
    'Other_Integrations_and_Use_Cases': 'Other Integrations',
    'PDF_and_Document_Processing': 'PDF Processing',
    'Personal_Productivity': 'Personal Productivity',
    'Product': 'Product',
    'Project_Management': 'Project Management',
    'Sales': 'Sales',
    'SecOps': 'Security Operations',
    'Slack': 'Slack',
    'Social_Media': 'Social Media',
    'Support': 'Support',
    'Support_Chatbot': 'Support Chatbot',
    'Telegram': 'Telegram',
    'Ticket_Management': 'Ticket Management',
    'WhatsApp': 'WhatsApp',
    'WordPress': 'WordPress'
  };
  
  return folderCategoryMap[folderName] || 'Other';
}

/**
 * Extract integrations from workflow nodes
 */
function extractIntegrations(workflow) {
  const integrations = new Set();
  
  if (workflow.nodes) {
    workflow.nodes.forEach(node => {
      const nodeType = node.type;
      
      // Map node types to integration names
      const integrationMap = {
        'n8n-nodes-base.telegram': 'Telegram',
        'n8n-nodes-base.gmail': 'Gmail',
        'n8n-nodes-base.googleSheets': 'Google Sheets',
        'n8n-nodes-base.googleDrive': 'Google Drive',
        'n8n-nodes-base.webhook': 'Webhook',
        'n8n-nodes-base.httpRequest': 'HTTP Request',
        'n8n-nodes-base.if': 'Conditional Logic',
        'n8n-nodes-base.set': 'Data Processing',
        'n8n-nodes-base.merge': 'Data Merge',
        'n8n-nodes-base.switch': 'Data Routing',
        '@n8n/n8n-nodes-langchain.agent': 'AI Agent',
        '@n8n/n8n-nodes-langchain.lmChatOpenAi': 'OpenAI',
        '@n8n/n8n-nodes-langchain.memoryBufferWindow': 'Memory Management',
        'n8n-nodes-base.googleDocs': 'Google Docs',
        'n8n-nodes-base.googleDocsTool': 'Google Docs API'
      };
      
      if (integrationMap[nodeType]) {
        integrations.add(integrationMap[nodeType]);
      }
    });
  }
  
  return Array.from(integrations);
}

/**
 * Generate business content using OpenAI
 */
async function generateBusinessContent(filename, workflow, integrations) {
  const prompt = `
Analyze this N8N workflow and create business-focused content for a marketplace:

Filename: "${filename}"
Integrations: ${integrations.join(', ')}

Workflow Structure:
- Nodes: ${workflow.nodes?.length || 0}
- Connections: ${Object.keys(workflow.connections || {}).length}

Create:
1. Business-focused title (max 60 chars)
2. Description (max 800 chars) - Use this engaging format with HTML-like structure:
   - Start with an emoji and compelling hook
   - Use numbered steps (1️⃣, 2️⃣, 3️⃣, 4️⃣) to explain how it works
   - Include benefits with checkmarks (✅)
   - End with a call-to-action
   - Use line breaks and formatting for readability
   - Example format:
   "🤖 [Compelling Hook] 🚀 [Brief description of what it does]... 
   
   💡 How it works:
   1️⃣ [Step 1 description]
   2️⃣ [Step 2 description]
   3️⃣ [Step 3 description]
   4️⃣ [Step 4 description]
   
   🔥 Why it's a game-changer:
   ✅ [Benefit 1]
   ✅ [Benefit 2]
   ✅ [Benefit 3]
   
   [Call-to-action about the value and opportunity]"
3. Features array (max 4 items, 2-4 words each)
4. Business value statement (max 150 chars)
5. Categories (1-3 from: New, Design, Creative, Productivity, Development, Business, Education, Entertainment, Writing, Self Improvement, Music & Sound Design, Software Development, Drawing & Painting, 3D)

Return JSON format:
{
  "title": "...",
  "description": "...",
  "features": ["...", "..."],
  "businessValue": "...",
  "categories": ["...", "..."]
}
`;

  try {
    const response = await openai.chat.completions.create({
      model: CONFIG.OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: "You are an expert in creating business-focused marketplace content for automation workflows. Return only valid JSON."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      max_tokens: 800,
      temperature: 0.3
    });

    const cost = estimateCost(
      response.usage.prompt_tokens,
      response.usage.completion_tokens
    );

    console.log(`💰 API Call ${++apiCallCount}: $${cost.toFixed(4)} (Total: $${totalCost.toFixed(4)})`);

    return JSON.parse(response.choices[0].message.content.trim());
  } catch (error) {
    console.error('❌ OpenAI API error:', error.message);
    throw error;
  }
}

/**
 * Estimate OpenAI API cost
 */
function estimateCost(inputTokens, outputTokens) {
  const inputCostPer1000 = 0.00015;
  const outputCostPer1000 = 0.0006;
  
  const cost = (inputTokens / 1000 * inputCostPer1000) + (outputTokens / 1000 * outputCostPer1000);
  totalCost += cost;
  return cost;
}

/**
 * Upload workflow file to Firebase Storage
 */
async function uploadWorkflowFile(filePath, filename) {
  try {
    const file = bucket.file(`agent_templates/${filename}`);
    
    // Upload the file
    await bucket.upload(filePath, {
      destination: file,
      metadata: {
        contentType: 'application/json'
      }
    });
    
    // Get the download URL
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 1000 * 60 * 60 * 24 * 365 // 1 year
    });
    
    // Get file metadata
    const [metadata] = await file.getMetadata();
    
    return {
      url,
      size: parseInt(metadata.size),
      contentType: 'application/json'
    };
  } catch (error) {
    console.error('❌ Upload error:', error.message);
    throw error;
  }
}

/**
 * Generate pricing based on complexity and random distribution
 */
function generatePricing(complexity, nodeCount) {
  // 50% chance of being free
  const isFree = Math.random() < 0.5;
  
  if (isFree) {
    return {
      price: 0,
      isFree: true,
      priceType: 'fixed',
      pricingTier: 'free'
    };
  }
  
  // For paid agents, price based on complexity
  let basePrice;
  if (complexity === 'high' || nodeCount > 20) {
    // High complexity: $30-50
    basePrice = Math.floor(Math.random() * 3) * 5 + 30; // 30, 35, 40, 45, 50
  } else if (complexity === 'medium' || nodeCount > 10) {
    // Medium complexity: $20-30
    basePrice = Math.floor(Math.random() * 3) * 5 + 20; // 20, 25, 30
  } else {
    // Low complexity: $10-20
    basePrice = Math.floor(Math.random() * 3) * 5 + 10; // 10, 15, 20
  }
  
  return {
    price: basePrice,
    isFree: false,
    priceType: 'fixed',
    pricingTier: basePrice >= 30 ? 'premium' : 'standard'
  };
}

/**
 * Process a single workflow file
 */
async function processWorkflowFile(filePath, category) {
  try {
    console.log(`\n🔄 Processing: ${path.basename(filePath)}`);
    
    // Check if agent already exists (using filename without extension as ID)
    const filename = path.basename(filePath, '.json');
    if (existingAgents.has(filename)) {
      console.log(`⏭️  Skipping ${filename} - already exists in database`);
      return { skipped: true, reason: 'duplicate' };
    }
    
    // Read and parse workflow
    const workflowContent = await fs.promises.readFile(filePath, 'utf8');
    const workflow = JSON.parse(workflowContent);
    
    // Extract integrations
    const integrations = extractIntegrations(workflow);
    console.log(`📊 Integrations found: ${integrations.join(', ')}`);
    
    // Generate business content
    const businessContent = await generateBusinessContent(
      path.basename(filePath),
      workflow,
      integrations
    );
    
    // Upload workflow file
    const uploadResult = await uploadWorkflowFile(filePath, path.basename(filePath));
    
    // Determine complexity and pricing
    const nodeCount = workflow.nodes?.length || 0;
    const complexity = nodeCount > 20 ? 'high' : nodeCount > 10 ? 'medium' : 'low';
    const pricing = generatePricing(complexity, nodeCount);
    
    // Generate clean filename for deliverables
    const cleanFileName = path.basename(filePath)
      .replace(/^\d+_/, '') // Remove ID numbers
      .replace(/_/g, '-') // Replace underscores with dashes
      .replace(/\s+/g, '-') // Replace spaces with dashes
      .toLowerCase()
      .replace(/[^a-z0-9\-\.]/g, '') // Keep only letters, numbers, dashes, dots
      .replace(/\.json$/, '') + '-workflow.json';
    
    // Create agent document
    const agentData = {
      // Basic Information
      name: businessContent.title,
      title: businessContent.title,
      description: businessContent.description,
      features: businessContent.features,
      categories: [...businessContent.categories, 'New', getFolderCategory(filePath)], // Add 'New' and folder-based category
      category: businessContent.categories[0] || 'Business', // Primary category
      businessValue: businessContent.businessValue,
      
      // Pricing
      price: pricing.price,
      currency: 'USD',
      isFree: pricing.isFree,
      priceType: pricing.priceType,
      pricingTier: pricing.pricingTier,
      
      // Status Flags
      isActive: true,
      isFeatured: false,
      isPopular: false,
      isTrending: false,
      isVerified: true,
      
      // Statistics
      downloadCount: 0,
      averageRating: 0,
      rating: 0,
      reviewCount: 0,
      reviews: [],
      likes: [],
      
      // Creator Information
      creator: {
        email: 'aiwaverider8@gmail.com',
        id: '0pYyiwNXvSZdoRa1Smgj3sWWYsg1',
        name: 'AI Wave Rider',
        username: 'aiwaverider8',
        role: 'admin',
        imageUrl: ''
      },
      
      // File Information
      jsonFile: {
        fileName: `agent_templates/${path.basename(filePath)}`,
        originalName: path.basename(filePath),
        url: uploadResult.url,
        size: uploadResult.size,
        contentType: uploadResult.contentType
      },
      
      // Deliverables
      deliverables: [
        {
          fileName: cleanFileName,
          description: `Complete ${businessContent.title.toLowerCase()} workflow for n8n`,
          downloadUrl: uploadResult.url,
          size: uploadResult.size,
          contentType: uploadResult.contentType
        },
        {
          fileName: 'Setup Guide.txt',
          description: 'Step-by-step installation and configuration instructions',
          downloadUrl: 'gs://aiwaverider.firebasestorage.app/agents/documents/README.txt',
          size: 2048,
          contentType: 'text/plain'
        }
      ],
      
      // Workflow Metadata
      workflowMetadata: {
        integrations: integrations,
        nodeCount: nodeCount,
        connectionCount: Object.keys(workflow.connections || {}).length,
        complexity: complexity,
        triggerType: 'Manual', // Default
        hasCredentials: true,
        fileSize: uploadResult.size,
        fileHash: require('crypto').createHash('md5').update(workflowContent).digest('hex'),
        workflowId: workflow.id || 'unknown'
      },
      
      // Images (empty - frontend will generate placeholders)
      image: {
        url: '',
        fileName: '',
        size: 0,
        contentType: 'image/png'
      },
      icon: {
        id: path.basename(filePath, '.json')
      },
      
      // Compliance and Timestamps
      paddleCompliant: true,
      createdAt: new Date().toISOString(),
      analyzedAt: new Date().toLocaleDateString(),
      lastTransformed: new Date().toISOString()
    };
    
    console.log(`💰 Pricing: ${pricing.isFree ? 'FREE' : '$' + pricing.price} (${pricing.pricingTier})`);
    console.log(`📊 Complexity: ${complexity} (${nodeCount} nodes)`);
    
    return agentData;
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error.message);
    throw error;
  }
}

/**
 * Find workflow files to process
 */
async function findWorkflowFiles() {
  const files = [];
  
  try {
    const categories = await fs.promises.readdir(CONFIG.N8N_WORKFLOWS_PATH, { withFileTypes: true });
    
    for (const category of categories) {
      if (category.isDirectory() && category.name !== '.git' && category.name !== 'img') {
        const categoryPath = path.join(CONFIG.N8N_WORKFLOWS_PATH, category.name);
        const categoryFiles = await fs.promises.readdir(categoryPath);
        
        for (const file of categoryFiles) {
          if (file.endsWith('.json')) {
            files.push({
              path: path.join(categoryPath, file),
              category: category.name,
              filename: file
            });
          }
        }
      }
    }
  } catch (error) {
    console.error('❌ Error scanning directories:', error.message);
    throw error;
  }
  
  return files;
}

/**
 * Main processing function
 */
async function main() {
  try {
    console.log('🚀 N8N Workflow Processor');
    console.log('=========================\n');
    
    // Load existing agents to check for duplicates
    const loaded = await loadExistingAgents();
    if (!loaded) {
      console.error('❌ Failed to load existing agents. Exiting...');
      return;
    }
    
    if (CONFIG.TEST_MODE) {
      console.log('🧪 TEST MODE - Processing only 1 agent\n');
    }
    
    // Find workflow files
    console.log('📁 Scanning for workflow files...');
    const workflowFiles = await findWorkflowFiles();
    console.log(`📊 Found ${workflowFiles.length} workflow files`);
    
    if (workflowFiles.length === 0) {
      console.log('❌ No workflow files found');
      return;
    }
    
    // Process files (1 for testing)
    const filesToProcess = CONFIG.TEST_MODE ? workflowFiles.slice(0, 1) : workflowFiles;
    
    let processedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    
    console.log(`\n🔄 Processing ${filesToProcess.length} workflow files...\n`);
    
    for (const fileInfo of filesToProcess) {
      try {
        const result = await processWorkflowFile(fileInfo.path, fileInfo.category);
        
        if (result.skipped) {
          skippedCount++;
          continue;
        }
        
        // Save to Firebase using filename as document ID
        const filename = path.basename(fileInfo.path, '.json');
        const docRef = db.collection(CONFIG.COLLECTION_NAME).doc(filename);
        await docRef.set(result);
        console.log(`✅ Created agent: ${filename}`);
        console.log(`📋 Title: ${result.title}`);
        console.log(`📝 Description: ${result.description}`);
        console.log(`🏷️  Categories: ${result.categories.join(', ')}`);
        
        processedCount++;
        
        // Delay between API calls
        await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_CALLS));
        
      } catch (error) {
        console.error(`❌ Failed to process ${fileInfo.filename}:`, error.message);
        errorCount++;
      }
    }
    
    // Final statistics
    console.log('\n📊 Processing Complete!');
    console.log('========================');
    console.log(`✅ Processed: ${processedCount} agents`);
    console.log(`⏭️  Skipped (duplicates): ${skippedCount} agents`);
    console.log(`❌ Errors: ${errorCount} agents`);
    console.log(`💰 Total cost: $${totalCost.toFixed(4)}`);
    console.log(`📞 API calls made: ${apiCallCount}`);
    
  } catch (error) {
    console.error('❌ Script failed:', error);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { processWorkflowFile, extractIntegrations };
