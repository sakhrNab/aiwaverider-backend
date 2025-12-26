const { renameTxtToJson } = require('./rename-txt-to-json');
const { testSingleWorkflow } = require('./test-n8n-workflow');

/**
 * Complete setup process for N8N workflows
 */
async function runSetup() {
  try {
    console.log('🚀 N8N Workflows Setup');
    console.log('======================\n');
    
    // Step 1: Rename .txt files to .json
    console.log('📝 Step 1: Renaming .txt files to .json...');
    const renameResult = await renameTxtToJson('E:\\N8N\\n8n-master-workflows');
    console.log(`✅ Renamed ${renameResult.renamedCount} files`);
    console.log(`❌ Errors: ${renameResult.errorCount}\n`);
    
    // Step 2: Test with a single workflow
    console.log('🧪 Step 2: Testing with a single workflow...');
    await testSingleWorkflow();
    
    console.log('\n🎉 Setup completed!');
    console.log('💡 Next steps:');
    console.log('   1. Review the test results above');
    console.log('   2. If everything looks good, run the main processor');
    console.log('   3. Check the Firebase agents collection for the new agent');
    
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    console.error(error.stack);
  }
}

// Run if called directly
if (require.main === module) {
  runSetup();
}

module.exports = { runSetup };
