/**
 * Test script to validate the n8n workflow upload functionality
 * This will process just the first few workflows to test the system
 * 
 * Run with: node scripts/testN8nUpload.js
 */

require('dotenv').config();
const { createAgentFromWorkflow, determineCategory } = require('./uploadN8nWorkflows');
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

// Configuration
const JSON_FILES_PATH = 'E:\\AIWaverider\\n8n\\n8n-workflows\\exported_workflows\\json_files';
const CSV_FILE_PATH = path.join(__dirname, '..', 'workflows.csv');

/**
 * Read first few rows of CSV for testing
 */
async function readTestWorkflowMetadata() {
  return new Promise((resolve, reject) => {
    const workflowData = new Map();
    let count = 0;
    
    fs.createReadStream(CSV_FILE_PATH)
      .pipe(csv())
      .on('data', (row) => {
        if (row.filename && count < 5) { // Only process first 5 for testing
          workflowData.set(row.filename, row);
          count++;
        }
      })
      .on('end', () => {
        console.log(`Loaded metadata for ${workflowData.size} test workflows from CSV`);
        resolve(workflowData);
      })
      .on('error', reject);
  });
}

/**
 * Test the category determination function
 */
function testCategoryDetermination() {
  console.log('\n🧪 Testing category determination...');
  
  const testCases = [
    {
      name: 'Telegram Schedule Automation',
      description: 'Scheduled automation for productivity',
      integrations: 'Telegram, Schedule',
      expected: 'Productivity'
    },
    {
      name: 'YouTube Video Analysis',
      description: 'AI-powered video content analysis',
      integrations: 'YouTube, OpenAI',
      expected: 'Entertainment'
    },
    {
      name: 'GitHub Code Review',
      description: 'Automated code review with AI',
      integrations: 'GitHub, GitLab',
      expected: 'Software Development'
    },
    {
      name: 'Lead Generation CRM',
      description: 'Customer relationship management',
      integrations: 'Hubspot, Airtable',
      expected: 'Business'
    }
  ];
  
  testCases.forEach((test, index) => {
    const result = determineCategory(test.name, test.description, test.integrations);
    const status = result === test.expected ? '✅' : '❌';
    console.log(`  ${status} Test ${index + 1}: "${test.name}" → ${result} (expected: ${test.expected})`);
  });
}

/**
 * Test creating agent documents without uploading
 */
async function testAgentCreation() {
  try {
    console.log('\n🧪 Testing agent document creation...');
    
    // Check if required files exist
    if (!fs.existsSync(JSON_FILES_PATH)) {
      console.error(`❌ JSON files directory not found: ${JSON_FILES_PATH}`);
      return false;
    }
    
    if (!fs.existsSync(CSV_FILE_PATH)) {
      console.error(`❌ CSV file not found: ${CSV_FILE_PATH}`);
      return false;
    }
    
    // Read test metadata
    const workflowData = await readTestWorkflowMetadata();
    
    if (workflowData.size === 0) {
      console.error('❌ No workflow metadata found');
      return false;
    }
    
    // Get first few JSON files
    const jsonFiles = fs.readdirSync(JSON_FILES_PATH)
      .filter(file => file.endsWith('.json'))
      .slice(0, 3); // Test with first 3 files
    
    console.log(`📁 Testing with ${jsonFiles.length} JSON files...`);
    
    for (const filename of jsonFiles) {
      try {
        const filePath = path.join(JSON_FILES_PATH, filename);
        
        if (!fs.existsSync(filePath)) {
          console.warn(`⚠️  File not found: ${filename}`);
          continue;
        }
        
        // Read JSON content
        const jsonContent = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        // Create agent document
        const agent = createAgentFromWorkflow(filename, workflowData, jsonContent);
        
        if (agent) {
          console.log(`✅ Created agent for: ${agent.title}`);
          console.log(`   • ID: ${agent.id}`);
          console.log(`   • Category: ${agent.category}`);
          console.log(`   • Features: ${agent.features.slice(0, 3).join(', ')}...`);
          console.log(`   • Tags: ${agent.tags.slice(0, 3).join(', ')}...`);
          console.log(`   • Node Count: ${agent.workflowMetadata.nodeCount}`);
          console.log(`   • Integrations: ${agent.workflowMetadata.integrations.slice(0, 3).join(', ')}...`);
        } else {
          console.warn(`⚠️  Could not create agent for: ${filename}`);
        }
        
      } catch (error) {
        console.error(`❌ Error processing ${filename}:`, error.message);
      }
    }
    
    return true;
    
  } catch (error) {
    console.error('❌ Error in agent creation test:', error);
    return false;
  }
}

/**
 * Test file structure and paths
 */
function testFileStructure() {
  console.log('\n🧪 Testing file structure...');
  
  const checks = [
    {
      name: 'JSON files directory',
      path: JSON_FILES_PATH,
      type: 'directory'
    },
    {
      name: 'CSV metadata file',
      path: CSV_FILE_PATH,
      type: 'file'
    }
  ];
  
  let allGood = true;
  
  checks.forEach(check => {
    const exists = fs.existsSync(check.path);
    let isCorrectType = false;
    
    if (exists) {
      const stats = fs.statSync(check.path);
      isCorrectType = check.type === 'directory' ? stats.isDirectory() : stats.isFile();
    }
    
    const status = exists && isCorrectType ? '✅' : '❌';
    console.log(`  ${status} ${check.name}: ${check.path}`);
    
    if (!exists || !isCorrectType) {
      allGood = false;
    }
  });
  
  if (allGood) {
    // Count JSON files
    try {
      const jsonFiles = fs.readdirSync(JSON_FILES_PATH).filter(f => f.endsWith('.json'));
      console.log(`  📊 Found ${jsonFiles.length} JSON files to process`);
      
      // Show first few filenames as examples
      if (jsonFiles.length > 0) {
        console.log(`  📄 Example files:`);
        jsonFiles.slice(0, 3).forEach(file => {
          console.log(`     • ${file}`);
        });
        if (jsonFiles.length > 3) {
          console.log(`     • ... and ${jsonFiles.length - 3} more`);
        }
      }
    } catch (error) {
      console.warn(`  ⚠️  Could not read JSON files directory: ${error.message}`);
      allGood = false;
    }
  }
  
  return allGood;
}

/**
 * Run all tests
 */
async function runTests() {
  console.log('🔬 n8n Workflow Upload - Test Suite');
  console.log('===================================\n');
  
  let allTestsPassed = true;
  
  // Test 1: File structure
  const fileStructureOK = testFileStructure();
  if (!fileStructureOK) {
    console.log('\n❌ File structure test failed. Please check paths and files.');
    allTestsPassed = false;
  }
  
  // Test 2: Category determination
  testCategoryDetermination();
  
  // Test 3: Agent creation (only if file structure is OK)
  if (fileStructureOK) {
    const agentCreationOK = await testAgentCreation();
    if (!agentCreationOK) {
      console.log('\n❌ Agent creation test failed.');
      allTestsPassed = false;
    }
  } else {
    console.log('\n⏭️  Skipping agent creation test due to file structure issues.');
    allTestsPassed = false;
  }
  
  // Summary
  console.log('\n📋 Test Summary');
  console.log('===============');
  
  if (allTestsPassed) {
    console.log('✅ All tests passed! Ready to run the full upload.');
    console.log('\n💡 To run the full upload, execute:');
    console.log('   node scripts/uploadN8nWorkflows.js');
  } else {
    console.log('❌ Some tests failed. Please fix the issues before running the full upload.');
    console.log('\n🔧 Common fixes:');
    console.log('   • Verify the JSON files path exists');
    console.log('   • Ensure workflows.csv is in the correct location');
    console.log('   • Check file permissions');
  }
  
  return allTestsPassed;
}

/**
 * Main execution
 */
if (require.main === module) {
  runTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('\n💥 Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runTests,
  testCategoryDetermination,
  testAgentCreation,
  testFileStructure
}; 