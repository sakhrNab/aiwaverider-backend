/**
 * Test script for Stripe checkout with Google Pay payment method
 */
const axios = require('axios');

// Configuration
const API_URL = 'http://localhost:4000';

async function testGooglePayment() {
  console.log("\n===== Testing Google Pay Payment =====");
  
  try {
    const data = {
      cartTotal: 25.99,
      items: [
        {
          id: 'test-product-1',
          title: 'Test Product',
          price: 25.99,
          quantity: 1
        }
      ],
      currency: 'usd',
      countryCode: 'US',
      email: 'test@example.com',
      paymentMethodTypes: ['card', 'google_pay'] // This should be filtered correctly by the backend
    };
    
    console.log(`Sending request to ${API_URL}/api/payments/create-stripe-checkout`);
    console.log('Request data:', JSON.stringify(data, null, 2));
    
    try {
      const response = await axios.post(`${API_URL}/api/payments/create-stripe-checkout`, data);
      console.log(`✅ Success! Status: ${response.status}`);
      console.log('Response data:', JSON.stringify(response.data, null, 2));
      
      // Verify that the request was processed correctly
      console.log('\nVerification:');
      console.log('- Response contains a valid Stripe URL:', response.data.url?.includes('checkout.stripe.com'));
      console.log('- Response contains a valid session ID:', !!response.data.id);
      
      return response.data;
    } catch (apiError) {
      console.error(`❌ API Error: ${apiError.message}`);
      
      if (apiError.response) {
        console.error(`Status: ${apiError.response.status}`);
        console.error('Error data:', JSON.stringify(apiError.response.data, null, 2));
        
        // Print full error details for better debugging
        if (apiError.response.data && apiError.response.data.details) {
          console.error('Error details:', JSON.stringify(apiError.response.data.details, null, 2));
        }
      } else if (apiError.request) {
        console.error('No response received. Is the server running?');
      }
      
      throw apiError;
    }
  } catch (error) {
    console.error(`❌ General Error: ${error.message}`);
    throw error;
  }
}

// Run the test
testGooglePayment()
  .then(() => console.log('\n✅ Test completed successfully!'))
  .catch(() => console.error('\n❌ Test failed')); 