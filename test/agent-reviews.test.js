/**
 * Manual test script for agent reviews, ratings, and likes endpoints
 * 
 * To run these tests, execute the commands in your terminal
 * You'll need to replace :agentId with an actual agent ID from your database
 * You'll also need a valid Firebase auth token for authenticated endpoints
 */

// ***** SETUP *****
// First, get a valid agent ID to test with
// curl http://localhost:4000/api/agents?limit=1

// Get an auth token (if using Firebase Auth Emulator)
// curl -X POST "http://localhost:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key" \
//   -H "Content-Type: application/json" \
//   --data '{"email":"test@example.com","password":"password","returnSecureToken":true}'

// ***** TEST 1: GET REVIEWS FOR AN AGENT *****
// This endpoint should return all reviews for a given agent
// curl http://localhost:4000/api/agents/:agentId/reviews

// Expected response (200 OK):
// [
//   {
//     "id": "review1",
//     "agentId": ":agentId",
//     "userId": "user123",
//     "userName": "Test User",
//     "content": "This is a test review",
//     "rating": 4,
//     "createdAt": "2023-01-01T00:00:00.000Z"
//   }
// ]

// ***** TEST 2: ADD A REVIEW TO AN AGENT *****
// This endpoint should add a new review to an agent
// You'll need a valid Firebase auth token

// curl -X POST http://localhost:4000/api/agents/:agentId/reviews \
//   -H "Content-Type: application/json" \
//   -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
//   --data '{"content":"This is a test review from curl","rating":5}'

// Expected response (201 Created):
// {
//   "success": true,
//   "reviewId": "newReviewId",
//   "newRating": {
//     "average": 4.5,
//     "count": 2
//   }
// }

// ***** TEST 3: TOGGLE LIKE ON AN AGENT *****
// This endpoint should toggle like status for the current user
// You'll need a valid Firebase auth token

// curl -X POST http://localhost:4000/api/agents/:agentId/toggle-like \
//   -H "Content-Type: application/json" \
//   -H "Authorization: Bearer YOUR_AUTH_TOKEN"

// Expected response (200 OK):
// {
//   "success": true,
//   "liked": true,
//   "likesCount": 1
// }

// ***** TEST 4: UPDATE AGENT COLLECTIONS *****
// This endpoint should update all agents with necessary fields for ratings and likes

// curl -X POST http://localhost:4000/api/agents/update-collections

// Expected response (200 OK):
// {
//   "success": true,
//   "message": "Agent collections updated successfully"
// }

/**
 * Automated Testing with Node.js
 * 
 * If you prefer to run these tests programmatically,
 * you can use the code below in a Node.js environment
 */

const axios = require('axios');
const assert = require('assert');

// Configuration
const API_URL = 'http://localhost:4000/api';
const AUTH_TOKEN = 'YOUR_AUTH_TOKEN'; // Replace with actual token
const AGENT_ID = 'AGENT_ID'; // Replace with actual agent ID

async function runTests() {
  try {
    console.log('Starting agent reviews API tests...');
    
    // Test 1: Get reviews for an agent
    console.log('\nTest 1: Get reviews for an agent');
    const getReviewsResponse = await axios.get(`${API_URL}/agents/${AGENT_ID}/reviews`);
    assert(getReviewsResponse.status === 200, 'Expected 200 OK response');
    assert(Array.isArray(getReviewsResponse.data), 'Expected array response');
    console.log('✅ GET reviews test passed!');
    
    // Test 2: Add a review to an agent (requires auth)
    if (AUTH_TOKEN !== 'YOUR_AUTH_TOKEN') {
      console.log('\nTest 2: Add a review to an agent');
      const addReviewResponse = await axios.post(
        `${API_URL}/agents/${AGENT_ID}/reviews`,
        {
          content: 'Automated test review',
          rating: 5
        },
        {
          headers: {
            'Authorization': `Bearer ${AUTH_TOKEN}`
          }
        }
      );
      assert(addReviewResponse.status === 201, 'Expected 201 Created response');
      assert(addReviewResponse.data.success === true, 'Expected success response');
      assert(addReviewResponse.data.reviewId, 'Expected reviewId in response');
      console.log('✅ POST review test passed!');
    } else {
      console.log('⚠️ Skipping authenticated tests - no auth token provided');
    }
    
    // Test 3: Toggle like on an agent (requires auth)
    if (AUTH_TOKEN !== 'YOUR_AUTH_TOKEN') {
      console.log('\nTest 3: Toggle like on an agent');
      const toggleLikeResponse = await axios.post(
        `${API_URL}/agents/${AGENT_ID}/toggle-like`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${AUTH_TOKEN}`
          }
        }
      );
      assert(toggleLikeResponse.status === 200, 'Expected 200 OK response');
      assert(toggleLikeResponse.data.success === true, 'Expected success response');
      assert(typeof toggleLikeResponse.data.liked === 'boolean', 'Expected liked boolean in response');
      console.log('✅ Toggle like test passed!');
    }
    
    // Test 4: Update agent collections
    console.log('\nTest 4: Update agent collections');
    const updateCollectionsResponse = await axios.post(`${API_URL}/agents/update-collections`);
    assert(updateCollectionsResponse.status === 200, 'Expected 200 OK response');
    assert(updateCollectionsResponse.data.success === true, 'Expected success response');
    console.log('✅ Update collections test passed!');
    
    console.log('\nAll tests completed successfully! 🎉');
  } catch (error) {
    console.error('Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Uncomment to run the automated tests
// runTests();

module.exports = { runTests }; 