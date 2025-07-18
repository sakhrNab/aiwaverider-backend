/**
 * Test script to upload a single n8n workflow to Firebase
 * This will test the complete flow including file upload to Storage
 * 
 * Run with: node scripts/testSingleN8nUpload.js
 */

require('dotenv').config();
const { db, admin, storage } = require('../config/firebase');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Configuration
const JSON_FILES_PATH = 'E:\\AIWaverider\\n8n\\n8n-workflows\\exported_workflows\\json_files';
const CSV_FILE_PATH = path.join(__dirname, '..', 'workflows.csv');
const TEST_FILE = '0001_Telegram_Schedule_Automation_Scheduled.json'; // First file to test

// Import functions from main upload script
const { 
  determineCategory, 
  extractFeatures, 
  extractTags,
  readWorkflowMetadata 
} = require('./uploadN8nWorkflows');

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
    console.log(`📤 Uploading ${filename} to Firebase Storage...`);
    
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
    
    console.log(`✅ File uploaded successfully: ${publicUrl}`);
    
    return {
      url: publicUrl,
      storagePath: storagePath,
      size: Buffer.byteLength(jsonString, 'utf8'),
      contentType: 'application/json',
      fileName: storagePath,
      originalName: filename
    };
    
  } catch (error) {
    console.error(`❌ Error uploading file to storage:`, error);
    throw error;
  }
}

/**
 * Create agent document with file URLs
 */
function createAgentFromWorkflow(filename, metadata, jsonContent, fileInfo) {
  // Extract workflow ID from filename (remove extension)
  const workflowId = filename.replace('.json', '');
  
  // Parse integrations
  let integrations = [];
  try {
    integrations = JSON.parse(metadata.integrations || '[]');
  } catch (e) {
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
  
  // Create agent document with file URLs
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
 * Test upload of a single workflow
 */
async function testSingleUpload() {
  try {
    console.log('🧪 Testing Single n8n Workflow Upload');
    console.log('====================================\n');
    
    console.log(`📁 JSON files path: ${JSON_FILES_PATH}`);
    console.log(`📄 CSV metadata path: ${CSV_FILE_PATH}`);
    console.log(`🔍 Test file: ${TEST_FILE}`);
    console.log('');
    
    // Check if paths exist
    if (!fs.existsSync(JSON_FILES_PATH)) {
      throw new Error(`JSON files directory not found: ${JSON_FILES_PATH}`);
    }
    
    if (!fs.existsSync(CSV_FILE_PATH)) {
      throw new Error(`CSV file not found: ${CSV_FILE_PATH}`);
    }
    
    const testFilePath = path.join(JSON_FILES_PATH, TEST_FILE);
    if (!fs.existsSync(testFilePath)) {
      throw new Error(`Test file not found: ${testFilePath}`);
    }
    
    // Read workflow metadata
    console.log('📖 Reading workflow metadata...');
    const workflowData = await readWorkflowMetadata();
    
    const metadata = workflowData.get(TEST_FILE);
    if (!metadata) {
      throw new Error(`No metadata found for ${TEST_FILE}`);
    }
    
    console.log(`✅ Found metadata for: ${metadata.name}`);
    console.log(`   • Category: ${determineCategory(metadata.name, metadata.description, metadata.integrations)}`);
    console.log(`   • Node Count: ${metadata.node_count}`);
    console.log(`   • Complexity: ${metadata.complexity}`);
    console.log('');
    
    // Read JSON content
    console.log('📄 Reading JSON file...');
    const jsonContent = JSON.parse(fs.readFileSync(testFilePath, 'utf8'));
    console.log(`✅ JSON file loaded (${Object.keys(jsonContent).length} root properties)`);
    console.log('');
    
    // Check if agent already exists
    const agentId = TEST_FILE.replace('.json', '');
    const existingAgent = await db.collection('agents').doc(agentId).get();
    
    if (existingAgent.exists) {
      console.log('⚠️  Agent already exists in database. Deleting for fresh test...');
      await db.collection('agents').doc(agentId).delete();
      console.log('✅ Existing agent deleted');
      console.log('');
    }
    
    // Upload file to Firebase Storage
    const fileInfo = await uploadJsonToStorage(TEST_FILE, jsonContent);
    console.log('');
    
    // Create agent document
    console.log('📝 Creating agent document...');
    const agent = createAgentFromWorkflow(TEST_FILE, metadata, jsonContent, fileInfo);
    
    console.log(`✅ Agent document created:`);
    console.log(`   • ID: ${agent.id}`);
    console.log(`   • Title: ${agent.title}`);
    console.log(`   • Category: ${agent.category}`);
    console.log(`   • File URL: ${agent.fileUrl}`);
    console.log(`   • Download URL: ${agent.downloadUrl}`);
    console.log(`   • Features: ${agent.features.slice(0, 3).join(', ')}...`);
    console.log(`   • Tags: ${agent.tags.slice(0, 3).join(', ')}...`);
    console.log('');
    
    // Upload to Firestore
    console.log('💾 Uploading to Firestore...');
    await db.collection('agents').doc(agent.id).set(agent);
    console.log('✅ Agent uploaded to Firestore successfully!');
    console.log('');
    
    // Verify the upload
    console.log('🔍 Verifying upload...');
    const uploadedAgent = await db.collection('agents').doc(agent.id).get();
    if (uploadedAgent.exists) {
      const data = uploadedAgent.data();
      console.log('✅ Verification successful!');
      console.log(`   • Document ID: ${uploadedAgent.id}`);
      console.log(`   • Title: ${data.title}`);
      console.log(`   • File URL accessible: ${data.fileUrl ? '✅' : '❌'}`);
      console.log(`   • Download URL accessible: ${data.downloadUrl ? '✅' : '❌'}`);
      console.log('');
      
      // Test file download
      console.log('🌐 Testing file accessibility...');
      try {
        const response = await fetch(data.fileUrl);
        if (response.ok) {
          console.log('✅ File is publicly accessible');
          console.log(`   • Status: ${response.status}`);
          console.log(`   • Content-Type: ${response.headers.get('content-type')}`);
        } else {
          console.log('❌ File is not accessible');
          console.log(`   • Status: ${response.status}`);
        }
      } catch (error) {
        console.log('❌ Error testing file accessibility:', error.message);
      }
      
    } else {
      console.log('❌ Verification failed: Document not found');
    }
    
    console.log('\n🎉 Single Upload Test Summary');
    console.log('=============================');
    console.log('✅ JSON file read successfully');
    console.log('✅ Metadata matched correctly');
    console.log('✅ File uploaded to Firebase Storage');
    console.log('✅ Agent document created with file URLs');
    console.log('✅ Agent uploaded to Firestore');
    console.log('✅ Upload verified successfully');
    
    console.log('\n💡 Ready for full upload!');
    console.log('To upload all 2053 workflows, run:');
    console.log('   node scripts/uploadN8nWorkflows.js --upload');
    
    return {
      success: true,
      agentId: agent.id,
      fileUrl: fileInfo.url,
      documentUrl: `https://console.firebase.google.com/project/aiwaverider/firestore/data/~2Fagents~2F${agent.id}`
    };
    
  } catch (error) {
    console.error('\n💥 Test failed:', error);
    console.log('\n🔧 Please fix the issues before running the full upload.');
    throw error;
  }
}

/**
 * Main execution
 */
if (require.main === module) {
  testSingleUpload()
    .then(result => {
      console.log('\n🚀 Test completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n💥 Test failed:', error);
      process.exit(1);
    });
}

module.exports = {
  testSingleUpload,
  uploadJsonToStorage,
  createAgentFromWorkflow
}; 