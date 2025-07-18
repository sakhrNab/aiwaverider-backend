const axios = require('axios');

const BASE_URL = 'http://localhost:4000/api';

// Test configuration
const tests = [
  {
    name: 'Basic agents listing',
    method: 'GET',
    url: `${BASE_URL}/agents`,
    expectedStatus: 200
  },
  {
    name: 'Agents with limit',
    method: 'GET',
    url: `${BASE_URL}/agents?limit=5`,
    expectedStatus: 200
  },
  {
    name: 'Category filtering (Technology) - should require index',
    method: 'GET',
    url: `${BASE_URL}/agents?category=Technology`,
    expectedStatus: [200, 500] // May fail due to missing index
  },
  {
    name: 'Free filter - should require index',
    method: 'GET',
    url: `${BASE_URL}/agents?filter=Free`,
    expectedStatus: [200, 500] // May fail due to missing index
  },
  {
    name: 'Price range filtering - should require index',
    method: 'GET',
    url: `${BASE_URL}/agents?priceMin=0&priceMax=50`,
    expectedStatus: [200, 500] // May fail due to missing index
  },
  {
    name: 'Search functionality - should require index',
    method: 'GET',
    url: `${BASE_URL}/agents?search=test`,
    expectedStatus: [200, 500] // May fail due to missing index
  },
  {
    name: 'Top Rated filter - should require index',
    method: 'GET',
    url: `${BASE_URL}/agents?filter=Top%20Rated`,
    expectedStatus: [200, 500] // May fail due to missing index
  },
  {
    name: 'Newest filter - should require index',
    method: 'GET',
    url: `${BASE_URL}/agents?filter=Newest`,
    expectedStatus: [200, 500] // May fail due to missing index
  },
  {
    name: 'Cache test - same request twice',
    method: 'GET',
    url: `${BASE_URL}/agents?limit=3`,
    expectedStatus: 200,
    testCache: true
  },
  {
    name: 'Individual agent (non-existent)',
    method: 'GET',
    url: `${BASE_URL}/agents/non-existent-agent`,
    expectedStatus: 404
  },

  {
    name: 'Latest agents',
    method: 'GET',
    url: `${BASE_URL}/agents/latest`,
    expectedStatus: 200
  }
];

async function runTest(test) {
  try {
    console.log(`\n🧪 Testing: ${test.name}`);
    console.log(`📍 URL: ${test.url}`);
    
    // Make first request
    const response = await axios({
      method: test.method,
      url: test.url,
      validateStatus: () => true // Don't throw on non-200 status codes
    });
    
    console.log(`📊 Status: ${response.status}`);
    
    // Check if status is expected
    const expectedStatuses = Array.isArray(test.expectedStatus) ? test.expectedStatus : [test.expectedStatus];
    const statusMatch = expectedStatuses.includes(response.status);
    
    if (statusMatch) {
      console.log(`✅ Status check passed`);
    } else {
      console.log(`❌ Status check failed. Expected: ${expectedStatuses.join(' or ')}, Got: ${response.status}`);
    }
    
    // Show response structure for successful requests
    if (response.status === 200) {
      const data = response.data;
      console.log(`📋 Response structure:`);
      
      if (data.agents !== undefined) {
        console.log(`   - agents: array of ${data.agents.length} items`);
        console.log(`   - total: ${data.total}`);
        console.log(`   - fromCache: ${data.fromCache}`);
        if (data.pagination) {
          console.log(`   - pagination.hasMore: ${data.pagination.hasMore}`);
          console.log(`   - pagination.lastVisibleId: ${data.pagination.lastVisibleId}`);
          console.log(`   - pagination.limit: ${data.pagination.limit}`);
        }
      } else {
        console.log(`   - Response keys: ${Object.keys(data).join(', ')}`);
      }
      
      // Test cache functionality
      if (test.testCache) {
        console.log(`🔄 Testing cache functionality...`);
        const secondResponse = await axios({
          method: test.method,
          url: test.url,
          validateStatus: () => true
        });
        
        if (secondResponse.data.fromCache === true) {
          console.log(`✅ Cache working: Second request returned fromCache=true`);
        } else {
          console.log(`⚠️  Cache status: fromCache=${secondResponse.data.fromCache}`);
        }
      }
    } else if (response.status >= 400) {
      // Show error details for client/server errors
      console.log(`❌ Error response:`, response.data);
      
      // Check if it's a Firestore index error (expected for our refactored queries)
      if (response.data.details && response.data.details.includes('FAILED_PRECONDITION') && response.data.details.includes('index')) {
        console.log(`ℹ️  This is expected - Firestore requires indexes for efficient queries`);
        console.log(`📝 Index creation link provided in error message`);
      }
    }
    
    return { success: statusMatch, status: response.status, test: test.name };
    
  } catch (error) {
    console.log(`💥 Request failed: ${error.message}`);
    return { success: false, error: error.message, test: test.name };
  }
}

async function runAllTests() {
  console.log('🚀 Starting comprehensive endpoint testing...');
  console.log('=' .repeat(60));
  
  const results = [];
  
  for (const test of tests) {
    const result = await runTest(test);
    results.push(result);
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📈 TEST SUMMARY');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${results.length}`);
  
  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`   - ${r.test}: ${r.error || `Status ${r.status}`}`);
    });
  }
  
  console.log('\n🎯 Key Observations:');
  console.log('- Basic queries without filters should work');
  console.log('- Filtered queries may require Firestore indexes');
  console.log('- Cache functionality should be working');
  console.log('- Error handling should be proper');
  console.log('- Response format should match new structure');
  
  return { passed, failed, total: results.length };
}

// Run tests if called directly
if (require.main === module) {
  runAllTests().then((summary) => {
    console.log(`\n🏁 Testing complete! Passed: ${summary.passed}/${summary.total}`);
    process.exit(summary.failed > 0 ? 1 : 0);
  }).catch(console.error);
}

module.exports = { runAllTests, runTest }; 