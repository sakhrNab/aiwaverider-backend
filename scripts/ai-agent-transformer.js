const admin = require('firebase-admin');
const readline = require('readline');
const { OpenAI } = require('openai');

// Initialize Firebase (using your existing config)
require('../config/firebase.js');

const db = admin.firestore();
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // Make sure to set this
});

// Configuration
const CONFIG = {
  COLLECTION_NAME: 'agents', // or 'prompts' based on your setup
  BATCH_SIZE: 10, // Process 10 agents at a time
  MAX_COST_LIMIT: 50, // Stop if cost exceeds $50
  TEST_AGENT_COUNT: 1, // Number of agents to test first
  OPENAI_MODEL: 'gpt-4o-mini', // More cost-effective than gpt-4
  DELAY_BETWEEN_CALLS: 1000, // 1 second delay between API calls
};

// Cost tracking
let totalCost = 0;
let apiCallCount = 0;

/**
 * Create readline interface for user input
 */
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Ask user a yes/no question
 */
const askQuestion = (question) => {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.toLowerCase().trim() === 'yes' || answer.toLowerCase().trim() === 'y');
    });
  });
};

/**
 * Estimate OpenAI API cost
 */
const estimateCost = (inputTokens, outputTokens) => {
  // GPT-4o-mini pricing (as of 2024)
  const inputCostPer1000 = 0.00015; // $0.00015 per 1K input tokens
  const outputCostPer1000 = 0.0006; // $0.0006 per 1K output tokens
  
  const cost = (inputTokens / 1000 * inputCostPer1000) + (outputTokens / 1000 * outputCostPer1000);
  totalCost += cost;
  return cost;
};

/**
 * OpenAI Transformation Prompts
 */
const TRANSFORMATION_PROMPTS = {
  title: (currentTitle, integrations, originalDescription) => `
Transform this technical agent title into a business-focused product name:

Current title: "${currentTitle}"
Original description: "${originalDescription}"
Key integrations: ${integrations.join(', ')}

Requirements:
- Focus on the ACTUAL business purpose based on the original description and integrations
- Remove technical jargon (emojis, special characters, "AI Agent", "Complex", "Multi-step")
- Format: "[Business Process] Automation" or "[Main Integration] [Business Function]"
- Keep it under 60 characters
- Make it clear what business problem it solves
- NEVER mention "Paddle"
- Base the title on what the description says it does, not the filename

Examples:
- If description mentions "Google Drive, Gmail, and Google Sheets for data processing" → "Google Workspace Data Processing Automation"
- If description mentions "Instagram automation" → "Instagram Marketing Automation"
- If description mentions "Telegram customer support" → "Telegram Customer Support Agent"

Return only the new title, nothing else.`,

  description: (currentDesc, integrations, title, fileName) => `
Rewrite this agent description for AI Waverider marketplace:

Current description: "${currentDesc}"
Agent title: "${title}"
Key integrations: ${integrations.join(', ')}
Workflow file: "${fileName}"

Requirements:
- Start with business value: "Automates [specific process] using [key integrations]"
- Include deliverables: "Includes: ${fileName} (complete automation workflow) and Setup Guide.txt (installation instructions)"
- End with target: "Perfect for [specific audience] wanting [specific outcome]"
- Keep TOTAL length under 500 characters
- Focus on what the integrations actually do together
- NEVER mention "Paddle"

Structure exactly like this:
"Automates [process] using [integrations]. Includes: ${fileName} (complete automation workflow) and Setup Guide.txt (installation instructions). Perfect for [audience] wanting [outcome]."

CRITICAL: Return the complete description without quotes, exactly following the structure above. Do not truncate or cut short.`,

  features: (currentFeatures, integrations, title) => `
Transform these technical features into business benefits:

Current features: ${JSON.stringify(currentFeatures)}
Agent purpose: "${title}"
Integrations: ${integrations.join(', ')}

Requirements:
- Convert technical features to business benefits
- Examples: "Complex Workflow" → "Enterprise-Grade Solution", "Multi-service Integration" → "Seamless Platform Connection"
- Always include "Ready-to-Deploy" as one feature
- Focus on what the customer gets, not how it works
- Maximum 4 features
- Each feature should be 2-4 words

CRITICAL: Return ONLY a valid JSON array of feature strings, nothing else. No explanation, no text, just the JSON array.

Example format: ["Ready-to-Deploy", "Business Solution", "Automated Workflow", "Professional Grade"]`,

  businessValue: (integrations, title, description) => `
Create a compelling business value statement:

Agent: "${title}"
Description: "${description}"
Integrations: ${integrations.join(', ')}

Requirements:
- Start with specific business outcome: "Automates [specific process] reducing [specific metric] by [percentage]"
- Mention target audience: "Perfect for [specific type] of businesses"
- Keep under 150 characters total
- Focus on quantified benefits (time saved, efficiency gained, costs reduced)
- Make it about the business process, not technical features
- NEVER mention "Paddle"

Template: "Automates [process] reducing [metric] by [%]. Perfect for [audience] wanting [outcome]."

Return only the business value statement, nothing else.`,

  categories: (currentCategory, integrations, title, description) => `
Determine the most relevant business categories for this agent (can be multiple):

Current category: "${currentCategory}"
Agent title: "${title}"
Description: "${description}"
Integrations: ${integrations.join(', ')}

Available categories: Design, Creative, Productivity, Development, Business

Requirements:
- Choose 1-3 categories from the available list above
- Primary category should be the main business function
- Secondary categories should be relevant use cases
- Focus on what business departments/teams would use this agent
- For Paddle payment compliance, prefer Business over Development when possible

Category Guidelines:
- Design: Visual design, UI/UX, graphics, logos
- Creative: Content creation, writing, media production
- Productivity: Workflow automation, efficiency tools, task management
- Development: Technical workflows, API integrations, coding-related
- Business: General business processes, sales, marketing, customer service

Examples:
- Telegram customer support agent: ["Business", "Productivity"]
- Instagram marketing automation: ["Business", "Creative"]
- Document processing workflow: ["Productivity", "Business"]
- Logo design agent: ["Design", "Creative"]

CRITICAL: Return ONLY a valid JSON array using the exact category names above, nothing else. No explanation, no text, just the JSON array.

Example format: ["Business", "Productivity"]`
};

/**
 * Call OpenAI API with retry logic
 */
const callOpenAI = async (prompt, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      apiCallCount++;
      
      const response = await openai.chat.completions.create({
        model: CONFIG.OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content: "You are an expert in transforming technical product descriptions into business-focused marketplace content. Follow instructions exactly and return only what is requested."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 500,
        temperature: 0.3 // Lower temperature for consistent outputs
      });

      // Calculate cost
      const cost = estimateCost(
        response.usage.prompt_tokens,
        response.usage.completion_tokens
      );

      console.log(`💰 API Call ${apiCallCount}: $${cost.toFixed(4)} (Total: $${totalCost.toFixed(4)})`);

      // Check cost limit
      if (totalCost > CONFIG.MAX_COST_LIMIT) {
        throw new Error(`Cost limit exceeded: $${totalCost.toFixed(2)}`);
      }

      return response.choices[0].message.content.trim();

    } catch (error) {
      console.error(`❌ OpenAI API call failed (attempt ${i + 1}):`, error.message);
      
      if (i === retries - 1) throw error;
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
};

/**
 * Transform a single agent using OpenAI
 */
const transformAgent = async (agent) => {
  console.log(`\n🔄 Transforming agent: ${agent.title}`);
  
  const integrations = agent.workflowMetadata?.integrations || [];
  const currentFeatures = agent.features || [];
  
  try {
    // Transform each field
    const newTitle = await callOpenAI(
      TRANSFORMATION_PROMPTS.title(agent.title, integrations, agent.description)
    );
    await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_CALLS));

    let newDescription = await callOpenAI(
      TRANSFORMATION_PROMPTS.description(
        agent.description, 
        integrations, 
        newTitle,
        agent.jsonFile?.originalName || "workflow.json"
      )
    );
    
    // Validate description completeness
    if (newDescription.length < 100 || !newDescription.includes('Includes:') || !newDescription.includes('Perfect for')) {
      console.log(`⚠️  Description seems incomplete (${newDescription.length} chars), retrying...`);
      await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_CALLS));
      
      // Retry with simpler prompt
      const retryDescription = await callOpenAI(`
        Create a complete product description for "${newTitle}":
        
        "Automates [specific process] using ${integrations.join(', ')}. Includes: ${agent.jsonFile?.originalName || 'workflow.json'} (complete automation workflow) and Setup Guide.txt (installation instructions). Perfect for businesses wanting [specific benefit]."
        
        Fill in the brackets with specific details. Keep under 500 characters total. Return the complete description.
      `);
      
      if (retryDescription.length > newDescription.length && retryDescription.includes('Includes:')) {
        newDescription = retryDescription;
        console.log(`✅ Retry successful: ${retryDescription.length} chars`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_CALLS));

    const newFeaturesStr = await callOpenAI(
      TRANSFORMATION_PROMPTS.features(currentFeatures, integrations, newTitle)
    );
    
    console.log(`🔍 AI returned features: "${newFeaturesStr}"`); // Debug output
    await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_CALLS));
    await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_CALLS));

    const newBusinessValue = await callOpenAI(
      TRANSFORMATION_PROMPTS.businessValue(integrations, newTitle, newDescription)
    );
    await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_CALLS));

    const newCategoriesStr = await callOpenAI(
      TRANSFORMATION_PROMPTS.categories(agent.category, integrations, newTitle, newDescription)
    );
    
    console.log(`🔍 AI returned categories: "${newCategoriesStr}"`); // Debug output
    await new Promise(resolve => setTimeout(resolve, CONFIG.DELAY_BETWEEN_CALLS));

    // Validate all transformations are complete
    console.log('\n🔍 Validating transformations...');
    if (newTitle.length < 10) console.log('⚠️  Title too short');
    if (newDescription.length < 100) console.log('⚠️  Description too short');
    if (!newDescription.includes('Includes:')) console.log('⚠️  Description missing deliverables');
    if (!newDescription.includes('Perfect for')) console.log('⚠️  Description missing target audience');
    if (newBusinessValue.length < 50) console.log('⚠️  Business value too short');

    // Parse features and categories JSON safely
    let newFeatures, newCategories;
    try {
      newFeatures = JSON.parse(newFeaturesStr);
    } catch (e) {
      console.log(`⚠️  AI returned invalid JSON for features: "${newFeaturesStr}"`);
      // Fallback if JSON parsing fails
      newFeatures = ["Ready-to-Deploy", "Business Solution", "Automated Workflow", "Professional Grade"];
    }

    try {
      newCategories = JSON.parse(newCategoriesStr);
      // Ensure it's an array and limit to 3 categories
      if (!Array.isArray(newCategories)) {
        newCategories = [newCategories];
      }
      newCategories = newCategories.slice(0, 3);
    } catch (e) {
      console.log(`⚠️  AI returned invalid JSON for categories: "${newCategoriesStr}"`);
      // Simple fallback - determine from integrations using actual website categories
      if (integrations.some(i => i.toLowerCase().includes('telegram')) || 
          integrations.some(i => i.toLowerCase().includes('customer'))) {
        newCategories = ['Business', 'Productivity'];
      } else if (integrations.some(i => i.toLowerCase().includes('instagram')) || 
                 integrations.some(i => i.toLowerCase().includes('social'))) {
        newCategories = ['Business', 'Creative'];
      } else if (integrations.some(i => i.toLowerCase().includes('design')) || 
                 integrations.some(i => i.toLowerCase().includes('logo'))) {
        newCategories = ['Design', 'Creative'];
      } else if (integrations.some(i => i.toLowerCase().includes('document')) || 
                 integrations.some(i => i.toLowerCase().includes('workflow'))) {
        newCategories = ['Productivity', 'Business'];
      } else {
        newCategories = ['Business']; // Default to Business for Paddle compliance
      }
    }

    // Generate customer-friendly deliverables that match the title/purpose
    const cleanFileName = (originalName, agentTitle, integrations) => {
      if (!originalName) return "automation-workflow.json";
      
      // Extract key terms from title for better filename
      const titleWords = agentTitle.toLowerCase()
        .replace(/[^\w\s]/g, '') // Remove special chars
        .split(' ')
        .filter(word => word.length > 3) // Keep meaningful words
        .slice(0, 3); // Max 3 words
      
      // If we have meaningful title words, use them
      if (titleWords.length > 0) {
        return titleWords.join('-') + '-workflow.json';
      }
      
      // Fallback: clean the original name
      return originalName
        .replace(/^\d+_/, '') // Remove ID numbers
        .replace(/_/g, '-') // Replace underscores with dashes
        .replace(/\s+/g, '-') // Replace spaces with dashes
        .toLowerCase()
        .replace(/[^a-z0-9\-\.]/g, '') // Keep only letters, numbers, dashes, dots
        .replace(/\.json$/, '') + '.json';
    };

    const customerFriendlyFileName = cleanFileName(
      agent.jsonFile?.originalName, 
      newTitle, 
      integrations
    );
    
    const deliverables = [
      {
        fileName: customerFriendlyFileName,
        description: `Complete ${newTitle.toLowerCase().replace(' automation', '')} workflow for n8n`,
        downloadUrl: agent.jsonFile?.url || "",
        size: agent.jsonFile?.size || 0,
        contentType: agent.jsonFile?.contentType || "application/json"
      },
      {
        fileName: "Setup Guide.txt",
        description: "Step-by-step installation and configuration instructions",
        downloadUrl: "gs://aiwaverider.firebasestorage.app/agents/documents/README.txt",
        size: 2048,
        contentType: "text/plain"
      }
    ];

    // Clean integration names
    const cleanIntegrations = integrations.map(integration => {
      return integration
        .replace(/tool$/i, ' API')
        .replace(/buffer/i, 'Storage')
        .replace(/lmchat/i, 'AI Chat')
        .replace(/openai/i, 'OpenAI');
    });

    return {
      original: agent,
      transformed: {
        title: newTitle,
        description: newDescription,
        features: newFeatures,
        categories: newCategories,
        businessValue: newBusinessValue,
        // Keep existing jsonFile structure (don't overwrite)
        jsonFile: agent.jsonFile, // Preserve existing workflow file data
        deliverables: deliverables,
        workflowMetadata: {
          ...agent.workflowMetadata,
          integrations: cleanIntegrations
        },
        paddleCompliant: true,
        lastTransformed: admin.firestore.FieldValue.serverTimestamp()
      }
    };

  } catch (error) {
    console.error(`❌ Failed to transform agent ${agent.id}:`, error.message);
    return null;
  }
};

/**
 * Display transformation preview
 */
const displayPreview = (original, transformed) => {
  console.log('\n' + '='.repeat(80));
  console.log(`📋 AGENT: ${original.id}`);
  console.log('='.repeat(80));
  
  console.log('\n📛 TITLE:');
  console.log(`❌ OLD: ${original.title}`);
  console.log(`✅ NEW: ${transformed.title}`);
  
  console.log('\n📝 DESCRIPTION:');
  console.log(`❌ OLD: ${original.description?.substring(0, 120)}...`);
  console.log(`✅ NEW: ${transformed.description}`); // Show FULL description
  
  console.log('\n🎯 FEATURES:');
  console.log(`❌ OLD: ${JSON.stringify(original.features)}`);
  console.log(`✅ NEW: ${JSON.stringify(transformed.features)}`);
  
  console.log('\n📊 CATEGORIES:');
  console.log(`❌ OLD: ${original.category || 'N/A'}`);
  console.log(`✅ NEW: ${JSON.stringify(transformed.categories)}`);
  console.log(`    Primary: ${transformed.categories[0]}`);
  if (transformed.categories.length > 1) {
    console.log(`    Secondary: ${transformed.categories.slice(1).join(', ')}`);
  }
  
  console.log('\n💼 BUSINESS VALUE:');
  console.log(`✅ NEW: ${transformed.businessValue}`);
  
  console.log('\n📦 DELIVERABLES:');
  transformed.deliverables.forEach(item => {
    console.log(`   - ${item.fileName}: ${item.description}`);
    if (item.downloadUrl) {
      console.log(`     URL: ${item.downloadUrl.substring(0, 60)}...`);
    }
  });
  
  console.log('\n📄 EXISTING WORKFLOW:');
  if (original.jsonFile) {
    console.log(`   File: ${original.jsonFile.originalName}`);
    console.log(`   Size: ${original.jsonFile.size} bytes`);
    console.log(`   Current URL: ${original.jsonFile.url.substring(0, 60)}...`);
  }
};

/**
 * Update agent in Firebase
 */
const updateAgentInFirebase = async (agentId, transformedData) => {
  try {
    await db.collection(CONFIG.COLLECTION_NAME).doc(agentId).update(transformedData);
    console.log(`✅ Updated agent ${agentId} in Firebase`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to update agent ${agentId}:`, error.message);
    return false;
  }
};

/**
 * Get agents to transform
 */
const getAgentsToTransform = async (limit = null) => {
  try {
    let query = db.collection(CONFIG.COLLECTION_NAME)
      .where('paddleCompliant', '!=', true) // Only get non-compliant agents
      .orderBy('price', 'desc') // Start with highest-priced
      .orderBy('downloadCount', 'desc');

    if (limit) {
      query = query.limit(limit);
    }

    const snapshot = await query.get();
    const agents = [];
    
    snapshot.forEach(doc => {
      agents.push({ id: doc.id, ...doc.data() });
    });

    return agents;
  } catch (error) {
    // If paddleCompliant field doesn't exist, get all agents
    console.log('📝 paddleCompliant field not found, getting all agents...');
    
    let query = db.collection(CONFIG.COLLECTION_NAME)
      .orderBy('price', 'desc')
      .orderBy('downloadCount', 'desc');

    if (limit) {
      query = query.limit(limit);
    }

    const snapshot = await query.get();
    const agents = [];
    
    snapshot.forEach(doc => {
      agents.push({ id: doc.id, ...doc.data() });
    });

    return agents;
  }
};

/**
 * Test transformation on a few agents
 */
const testTransformation = async () => {
  console.log('\n🧪 Testing transformation on sample agents...');
  
  const testAgents = await getAgentsToTransform(CONFIG.TEST_AGENT_COUNT);
  
  if (testAgents.length === 0) {
    console.log('❌ No agents found to transform');
    return false;
  }

  console.log(`📊 Found ${testAgents.length} agents for testing`);

  for (const agent of testAgents) {
    const result = await transformAgent(agent);
    
    if (result) {
      displayPreview(result.original, result.transformed);
    } else {
      console.log(`❌ Failed to transform agent: ${agent.id}`);
    }
  }

  console.log(`\n💰 Test cost: $${totalCost.toFixed(4)}`);
  console.log(`📊 Estimated total cost for all agents: $${(totalCost / testAgents.length * 2043).toFixed(2)}`);

  const proceed = await askQuestion('\n❓ Do the transformations look good? Continue with full processing? (yes/no): ');
  return proceed;
};

/**
 * Process all agents
 */
const processAllAgents = async () => {
  console.log('\n🚀 Starting full agent processing...');
  
  const allAgents = await getAgentsToTransform();
  console.log(`📊 Found ${allAgents.length} agents to process`);

  let processed = 0;
  let successful = 0;
  let failed = 0;

  for (let i = 0; i < allAgents.length; i += CONFIG.BATCH_SIZE) {
    const batch = allAgents.slice(i, i + CONFIG.BATCH_SIZE);
    
    console.log(`\n📦 Processing batch ${Math.floor(i / CONFIG.BATCH_SIZE) + 1}/${Math.ceil(allAgents.length / CONFIG.BATCH_SIZE)}`);
    
    for (const agent of batch) {
      try {
        const result = await transformAgent(agent);
        
        if (result) {
          const updated = await updateAgentInFirebase(agent.id, result.transformed);
          if (updated) {
            successful++;
          } else {
            failed++;
          }
        } else {
          failed++;
        }
        
        processed++;
        
        // Progress update
        if (processed % 50 === 0) {
          console.log(`\n📈 Progress: ${processed}/${allAgents.length} (${((processed / allAgents.length) * 100).toFixed(1)}%)`);
          console.log(`✅ Successful: ${successful} | ❌ Failed: ${failed} | 💰 Cost: $${totalCost.toFixed(2)}`);
        }

      } catch (error) {
        console.error(`❌ Error processing agent ${agent.id}:`, error.message);
        failed++;
        processed++;
      }
    }
    
    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  return { processed, successful, failed };
};

/**
 * Main execution function
 */
const main = async () => {
  try {
    console.log('🚀 AI Waverider Agent Transformer for Paddle Payment Compliance');
    console.log('=============================================================\n');

    // Check OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      console.error('❌ OPENAI_API_KEY environment variable not set');
      process.exit(1);
    }

    console.log('📋 Configuration:');
    console.log(`   - Model: ${CONFIG.OPENAI_MODEL}`);
    console.log(`   - Batch size: ${CONFIG.BATCH_SIZE}`);
    console.log(`   - Max cost: $${CONFIG.MAX_COST_LIMIT}`);
    console.log(`   - Test agents: ${CONFIG.TEST_AGENT_COUNT}`);

    // Step 1: Test transformation
    const shouldProceed = await testTransformation();
    
    if (!shouldProceed) {
      console.log('❌ User cancelled. Exiting...');
      return;
    }

    // Step 2: Process all agents
    const results = await processAllAgents();
    
    // Step 3: Final report
    console.log('\n' + '='.repeat(60));
    console.log('📊 FINAL REPORT');
    console.log('='.repeat(60));
    console.log(`✅ Successfully processed: ${results.successful}`);
    console.log(`❌ Failed: ${results.failed}`);
    console.log(`📊 Total processed: ${results.processed}`);
    console.log(`💰 Total cost: $${totalCost.toFixed(2)}`);
    console.log(`📞 API calls made: ${apiCallCount}`);
    console.log('\n🎉 Transformation complete! Your agents are now Paddle-compliant.');

  } catch (error) {
    console.error('❌ Script failed:', error);
  } finally {
    rl.close();
    process.exit(0);
  }
};

// Additional helper functions for monitoring and rollback

/**
 * Rollback function (in case something goes wrong)
 */
const rollbackTransformations = async () => {
  console.log('🔄 Rolling back transformations...');
  
  const transformedAgents = await db.collection(CONFIG.COLLECTION_NAME)
    .where('paddleCompliant', '==', true)
    .get();

  const batch = db.batch();
  
  transformedAgents.forEach(doc => {
    batch.update(doc.ref, {
      paddleCompliant: admin.firestore.FieldValue.delete(),
      lastTransformed: admin.firestore.FieldValue.delete()
      // Note: This doesn't restore original values, just removes the flags
    });
  });

  await batch.commit();
  console.log('✅ Rollback completed');
};

/**
 * Export functions for testing
 */
module.exports = {
  transformAgent,
  testTransformation,
  processAllAgents,
  rollbackTransformations,
  main
};

// Run if called directly
if (require.main === module) {
  main();
}