/**
 * Script to upload n8n workflow JSON files to Firebase agents collection
 * This script reads JSON files from the n8n exported workflows directory
 * and uploads them to the agents collection with metadata from workflows.csv
 * 
 * Run with: node scripts/uploadN8nWorkflows.js
 */

require('dotenv').config();
const { db, admin, storage } = require('../config/firebase');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Configuration
const JSON_FILES_PATH = 'E:\\AIWaverider\\n8n\\n8n-workflows\\exported_workflows\\json_files';
const CSV_FILE_PATH = path.join(__dirname, '..', 'workflows.csv');

// Categories mapping based on workflow functionality
const CATEGORY_KEYWORDS = {
  'Drawing & Painting': [
    'design', 'graphic', 'visual', 'image', 'canvas', 'art', 'creative',
    'photo', 'picture', 'illustration', 'render'
  ],
  '3D': [
    '3d', 'render', 'model', 'blender', 'mesh', 'geometry', 'cad',
    'presentation', 'visualization'
  ],
  'Music & Sound Design': [
    'audio', 'music', 'sound', 'voice', 'speech', 'transcription',
    'spotify', 'audio', 'microphone', 'recording'
  ],
  'Software Development': [
    'github', 'gitlab', 'git', 'code', 'api', 'development', 'deploy',
    'programming', 'software', 'app', 'web', 'frontend', 'backend',
    'docker', 'kubernetes', 'ci/cd', 'devops', 'repository', 'commit',
    'pull request', 'merge', 'branch', 'testing', 'debug', 'npm',
    'python', 'javascript', 'react', 'node', 'database', 'sql'
  ],
  'Business': [
    'crm', 'sales', 'customer', 'lead', 'business', 'marketing',
    'analytics', 'revenue', 'profit', 'invoice', 'payment', 'finance',
    'accounting', 'management', 'strategy', 'hubspot', 'salesforce',
    'airtable', 'sheet', 'spreadsheet', 'report', 'dashboard'
  ],
  'Education': [
    'learning', 'education', 'training', 'course', 'tutorial', 'teach',
    'student', 'classroom', 'knowledge', 'study', 'academic', 'university',
    'school', 'lesson', 'curriculum'
  ],
  'Entertainment': [
    'youtube', 'video', 'movie', 'entertainment', 'content', 'media',
    'streaming', 'podcast', 'game', 'fun', 'social', 'instagram',
    'tiktok', 'twitter', 'facebook', 'social media', 'viral', 'trend'
  ],
  'Writing': [
    'write', 'writing', 'text', 'document', 'article', 'blog', 'content',
    'copywriting', 'editing', 'proofreading', 'translation', 'language',
    'grammar', 'story', 'narrative', 'documentation', 'word', 'markdown'
  ],
  'Productivity': [
    'schedule', 'calendar', 'todo', 'task', 'productivity', 'automation',
    'workflow', 'organize', 'planning', 'reminder', 'notification',
    'email', 'gmail', 'outlook', 'slack', 'teams', 'communication',
    'meeting', 'appointment', 'sync', 'backup', 'file', 'storage',
    'google drive', 'dropbox', 'notion', 'asana', 'trello', 'jira'
  ]
};

// Default creator information
const DEFAULT_CREATOR = {
  email: "aiwaverider8@gmail.com",
  id: "0pYyiwNXvSZdoRa1Smgj3sWWYsg1",
  imageUrl: "",
  name: "AI Wave Rider",
  role: "admin",
  username: "aiwaverider8"
};

/**
 * Upload JSON file to Firebase Storage
 */
async function uploadJsonToStorage(filename, jsonContent) {
  try {
    // Create file path in storage
    const storagePath = `agent_templates/${Date.now()}_${filename}`;
    const file = storage.bucket().file(storagePath);
    
    // Convert JSON to string
    const jsonString = JSON.stringify(jsonContent, null, 2);
    
    // Upload file
    await file.save(jsonString, {
      metadata: {
        contentType: 'application/json',
        metadata: {
          originalName: filename,
          uploadedAt: new Date().toISOString()
        }
      }
    });
    
    // Make file publicly readable
    await file.makePublic();
    
    // Get public URL
    const publicUrl = `https://storage.googleapis.com/${storage.bucket().name}/${storagePath}`;
    
    return {
      url: publicUrl,
      storagePath: storagePath,
      size: Buffer.byteLength(jsonString, 'utf8'),
      contentType: 'application/json',
      fileName: storagePath,
      originalName: filename
    };
    
  } catch (error) {
    console.error(`❌ Error uploading file to storage:`, error.message);
    throw error;
  }
}

/**
 * Determine category based on workflow name, description, and integrations
 */
function determineCategory(name, description, integrations) {
  const searchText = `${name} ${description} ${integrations}`.toLowerCase();
  
  let bestMatch = 'Productivity'; // Default category
  let maxMatches = 0;
  
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const matches = keywords.reduce((count, keyword) => {
      return count + (searchText.includes(keyword.toLowerCase()) ? 1 : 0);
    }, 0);
    
    if (matches > maxMatches) {
      maxMatches = matches;
      bestMatch = category;
    }
  }
  
  return bestMatch;
}

/**
 * Extract features from workflow JSON and metadata
 */
function extractFeatures(jsonContent, metadata) {
  const features = [];
  
  // Add features based on node count
  if (metadata.node_count > 20) {
    features.push('Complex Workflow');
  } else if (metadata.node_count > 10) {
    features.push('Multi-step Process');
  } else {
    features.push('Simple Automation');
  }
  
  // Add features based on trigger type
  if (metadata.trigger_type) {
    features.push(`${metadata.trigger_type} Triggered`);
  }
  
  // Add features based on integrations
  if (metadata.integrations) {
    try {
      const integrations = JSON.parse(metadata.integrations);
      if (integrations.length > 5) {
        features.push('Multi-service Integration');
      }
      if (integrations.length > 10) {
        features.push('Enterprise Grade');
      }
    } catch (e) {
      // Fallback if integrations is not valid JSON
      if (metadata.integrations.includes('OpenAI') || metadata.integrations.includes('AI')) {
        features.push('AI Powered');
      }
    }
  }
  
  // Add AI-related features
  if (metadata.description && metadata.description.toLowerCase().includes('ai')) {
    features.push('AI Powered');
  }
  
  return features;
}

/**
 * Extract tags from metadata
 */
function extractTags(metadata) {
  const tags = [];
  
  // Add tags from CSV tags field
  if (metadata.tags) {
    try {
      const csvTags = JSON.parse(metadata.tags);
      tags.push(...csvTags.filter(tag => tag && tag.trim()));
    } catch (e) {
      // If not valid JSON, treat as comma-separated string
      const csvTags = metadata.tags.split(',').map(tag => tag.trim()).filter(tag => tag);
      tags.push(...csvTags);
    }
  }
  
  // Add complexity tag
  if (metadata.complexity) {
    tags.push(`${metadata.complexity} complexity`);
  }
  
  // Add node count tag
  if (metadata.node_count) {
    tags.push(`${metadata.node_count} nodes`);
  }
  
  // Add integration tags
  if (metadata.integrations) {
    try {
      const integrations = JSON.parse(metadata.integrations);
      // Add first 3 integrations as tags
      tags.push(...integrations.slice(0, 3));
    } catch (e) {
      // Fallback parsing
    }
  }
  
  return [...new Set(tags)]; // Remove duplicates
}

/**
 * Create agent document from workflow data
 */
function createAgentFromWorkflow(filename, workflowData, jsonContent, fileInfo) {
  const metadata = workflowData.get(filename);
  
  if (!metadata) {
    console.log(`No metadata found for ${filename}`);
    return null;
  }
  
  // Extract workflow ID from filename (remove extension)
  const workflowId = filename.replace('.json', '');
  
  // Parse integrations
  let integrations = [];
  try {
    integrations = JSON.parse(metadata.integrations || '[]');
  } catch (e) {
    // Fallback if not valid JSON
    if (metadata.integrations) {
      integrations = metadata.integrations.split(',').map(s => s.trim());
    }
  }
  
  // Determine category
  const category = determineCategory(
    metadata.name || '',
    metadata.description || '',
    integrations.join(' ')
  );
  
  // Extract features and tags
  const features = extractFeatures(jsonContent, metadata);
  const tags = extractTags(metadata);
  
  // Create agent document
  const agent = {
    id: workflowId,
    title: metadata.name || workflowId.replace(/_/g, ' '),
    description: metadata.description || 'n8n workflow automation',
    category: category,
    creator: DEFAULT_CREATOR,
    
    // Pricing information
    price: 0,
    currency: 'usd',
    
    // Ratings and popularity
    averageRating: 0,
    rating: 0,
    downloadCount: 0,
    reviews: [],
    
    // Status flags
    status: 'active',
    isActive: metadata.active === '1' || metadata.active === 1,
    isFeatured: false,
    isPopular: false,
    isTrending: false,
    isVerified: true,
    
    // Content
    features: features,
    tags: tags,
    
    // Workflow-specific metadata
    workflowMetadata: {
      workflowId: metadata.workflow_id || workflowId,
      nodeCount: parseInt(metadata.node_count) || 0,
      complexity: metadata.complexity || 'low',
      triggerType: metadata.trigger_type || 'manual',
      integrations: integrations,
      hasCredentials: metadata.has_credentials === 'TRUE',
      connectionCount: parseInt(metadata.connection_count) || 0,
      fileSize: parseInt(metadata.file_size) || 0,
      fileHash: metadata.file_hash || '',
      nodeTypes: metadata.node_types ? JSON.parse(metadata.node_types) : []
    },
    
    // File information with actual Firebase Storage URLs
    fileUrl: fileInfo.url,
    downloadUrl: fileInfo.url,
    
    // JSON file information
    jsonFile: {
      contentType: fileInfo.contentType,
      fileName: fileInfo.fileName,
      originalName: fileInfo.originalName,
      size: fileInfo.size,
      url: fileInfo.url
    },
    
    // Images (using placeholder for now)
    image: {
      url: '',
      fileName: '',
      size: 0,
      contentType: 'image/png'
    },
    icon: {},
    
    // Timestamps
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    analyzedAt: metadata.analyzed_at || new Date().toISOString()
  };
  
  return agent;
}

/**
 * Read workflow metadata from CSV
 */
async function readWorkflowMetadata() {
  return new Promise((resolve, reject) => {
    const workflowData = new Map();
    
    fs.createReadStream(CSV_FILE_PATH)
      .pipe(csv())
      .on('data', (row) => {
        if (row.filename) {
          workflowData.set(row.filename, row);
        }
      })
      .on('end', () => {
        console.log(`📊 Loaded metadata for ${workflowData.size} workflows from CSV`);
        resolve(workflowData);
      })
      .on('error', reject);
  });
}

/**
 * Upload agent to Firebase
 */
async function uploadAgent(agent) {
  try {
    const agentsRef = db.collection('agents');
    await agentsRef.doc(agent.id).set(agent);
    return true;
  } catch (error) {
    console.error(`❌ Error uploading agent ${agent.id}:`, error.message);
    return false;
  }
}

/**
 * Main upload function
 */
async function uploadWorkflows(dryRun = false) {
  try {
    console.log('🚀 Starting n8n workflow upload...');
    console.log(`📁 JSON files path: ${JSON_FILES_PATH}`);
    console.log(`📄 CSV metadata path: ${CSV_FILE_PATH}`);
    console.log(`🔄 Dry run: ${dryRun ? 'YES' : 'NO'}`);
    console.log('');
    
    // Check if paths exist
    if (!fs.existsSync(JSON_FILES_PATH)) {
      throw new Error(`JSON files directory not found: ${JSON_FILES_PATH}`);
    }
    
    if (!fs.existsSync(CSV_FILE_PATH)) {
      throw new Error(`CSV file not found: ${CSV_FILE_PATH}`);
    }
    
    // Read workflow metadata
    console.log('📖 Reading workflow metadata...');
    const workflowData = await readWorkflowMetadata();
    
    // Get JSON files
    const jsonFiles = fs.readdirSync(JSON_FILES_PATH)
      .filter(file => file.endsWith('.json'))
      .sort();
    
    console.log(`📦 Found ${jsonFiles.length} JSON files to process`);
    console.log('');
    
    let processed = 0;
    let uploaded = 0;
    let skipped = 0;
    let errors = 0;
    
    for (const filename of jsonFiles) {
      try {
        console.log(`📝 Processing: ${filename}`);
        
        const filePath = path.join(JSON_FILES_PATH, filename);
        
        // Read JSON content
        const jsonContent = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        if (dryRun) {
          // Create agent document without file upload for dry run
          const agent = createAgentFromWorkflow(filename, workflowData, jsonContent, {
            url: 'https://storage.googleapis.com/aiwaverider.firebasestorage.app/agent_templates/placeholder.json',
            size: JSON.stringify(jsonContent).length,
            contentType: 'application/json',
            fileName: `agent_templates/${filename}`,
            originalName: filename
          });
          
          if (!agent) {
            console.log(`⏭️  Skipped: No metadata found`);
            skipped++;
            continue;
          }
          
          console.log(`✅ Would create agent: ${agent.title}`);
          console.log(`   • Category: ${agent.category}`);
          console.log(`   • Features: ${agent.features.slice(0, 2).join(', ')}...`);
          console.log(`   • Node Count: ${agent.workflowMetadata.nodeCount}`);
          uploaded++;
        } else {
          // Check if agent already exists
          const agentId = filename.replace('.json', '');
          const existingAgent = await db.collection('agents').doc(agentId).get();
          if (existingAgent.exists) {
            console.log(`⚠️  Agent already exists: ${agentId}`);
            skipped++;
            continue;
          }
          
          // Upload file to Firebase Storage
          console.log(`📤 Uploading to Storage...`);
          const fileInfo = await uploadJsonToStorage(filename, jsonContent);
          
          // Create agent document with file URLs
          const agent = createAgentFromWorkflow(filename, workflowData, jsonContent, fileInfo);
          
          if (!agent) {
            console.log(`⏭️  Skipped: No metadata found`);
            skipped++;
            continue;
          }
          
          // Upload to Firebase
          const success = await uploadAgent(agent);
          if (success) {
            console.log(`✅ Uploaded: ${agent.title}`);
            console.log(`   • File URL: ${fileInfo.url}`);
            uploaded++;
          } else {
            console.log(`❌ Failed to upload: ${agent.title}`);
            errors++;
          }
        }
        
        processed++;
        
        // Progress update every 10 files
        if (processed % 10 === 0) {
          console.log(`\n📊 Progress: ${processed}/${jsonFiles.length} processed\n`);
        }
        
      } catch (error) {
        console.error(`❌ Error processing ${filename}:`, error.message);
        errors++;
      }
    }
    
    // Final summary
    console.log('\n🎉 Upload Summary');
    console.log('================');
    console.log(`📦 Total files: ${jsonFiles.length}`);
    console.log(`✅ ${dryRun ? 'Would upload' : 'Uploaded'}: ${uploaded}`);
    console.log(`⏭️  Skipped: ${skipped}`);
    console.log(`❌ Errors: ${errors}`);
    console.log(`📊 Processed: ${processed}`);
    
    if (dryRun) {
      console.log('\n💡 This was a dry run. To actually upload, run:');
      console.log('   node scripts/uploadN8nWorkflows.js --upload');
    } else {
      console.log('\n🎉 All files uploaded with Firebase Storage URLs!');
    }
    
    return {
      total: jsonFiles.length,
      uploaded,
      skipped,
      errors,
      processed
    };
    
  } catch (error) {
    console.error('💥 Upload failed:', error);
    throw error;
  }
}

/**
 * Main execution
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  const isDryRun = !args.includes('--upload');
  
  uploadWorkflows(isDryRun)
    .then(result => {
      console.log('\n🚀 Upload completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Upload failed:', error);
      process.exit(1);
    });
}

module.exports = {
  uploadWorkflows,
  createAgentFromWorkflow,
  determineCategory,
  readWorkflowMetadata,
  uploadJsonToStorage,
  extractFeatures,
  extractTags
}; 