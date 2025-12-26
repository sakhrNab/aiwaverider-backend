const fs = require('fs');
const path = require('path');

// Configuration
const N8N_WORKFLOWS_PATH = 'E:\\N8N\\n8n-master-workflows';
const DRY_RUN = true; // Set to false to actually rename files

/**
 * Recursively find and rename .txt files to .json
 */
async function renameTxtToJson(directory) {
  let renamedCount = 0;
  let errorCount = 0;
  
  try {
    const items = await fs.promises.readdir(directory, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(directory, item.name);
      
      if (item.isDirectory()) {
        // Skip .git directory
        if (item.name === '.git') continue;
        
        // Recursively process subdirectories
        const subResult = await renameTxtToJson(fullPath);
        renamedCount += subResult.renamedCount;
        errorCount += subResult.errorCount;
      } else if (item.isFile() && item.name.endsWith('.txt')) {
        try {
          const newPath = fullPath.replace('.txt', '.json');
          
          if (DRY_RUN) {
            console.log(`[DRY RUN] Would rename: ${path.relative(N8N_WORKFLOWS_PATH, fullPath)} -> ${path.relative(N8N_WORKFLOWS_PATH, newPath)}`);
          } else {
            await fs.promises.rename(fullPath, newPath);
            console.log(`✅ Renamed: ${path.relative(N8N_WORKFLOWS_PATH, fullPath)} -> ${path.relative(N8N_WORKFLOWS_PATH, newPath)}`);
          }
          
          renamedCount++;
        } catch (error) {
          console.error(`❌ Error renaming ${fullPath}:`, error.message);
          errorCount++;
        }
      }
    }
  } catch (error) {
    console.error(`❌ Error reading directory ${directory}:`, error.message);
    errorCount++;
  }
  
  return { renamedCount, errorCount };
}

/**
 * Main function
 */
async function main() {
  console.log('🔄 N8N Workflows File Renamer');
  console.log('==============================\n');
  
  if (DRY_RUN) {
    console.log('🔍 DRY RUN MODE - No files will be actually renamed\n');
  }
  
  console.log(`📁 Processing directory: ${N8N_WORKFLOWS_PATH}`);
  
  // Check if directory exists
  try {
    await fs.promises.access(N8N_WORKFLOWS_PATH);
  } catch (error) {
    console.error(`❌ Directory not found: ${N8N_WORKFLOWS_PATH}`);
    process.exit(1);
  }
  
  const startTime = Date.now();
  const result = await renameTxtToJson(N8N_WORKFLOWS_PATH);
  const endTime = Date.now();
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 RENAMING SUMMARY');
  console.log('='.repeat(50));
  console.log(`✅ Files renamed: ${result.renamedCount}`);
  console.log(`❌ Errors: ${result.errorCount}`);
  console.log(`⏱️  Time taken: ${((endTime - startTime) / 1000).toFixed(2)}s`);
  
  if (DRY_RUN) {
    console.log('\n💡 To actually rename files, set DRY_RUN = false in the script');
  } else {
    console.log('\n🎉 File renaming completed!');
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { renameTxtToJson };
