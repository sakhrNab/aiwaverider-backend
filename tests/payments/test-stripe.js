/**
 * Test script for Stripe checkout with various payment methods
 */
const axios = require('axios');

// Configuration
const API_URL = 'http://localhost:4000';

async function testStripeCheckout(paymentMethod) {
  console.log(`\n===== Testing Stripe Checkout with ${paymentMethod} =====`);
  
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
      currency: paymentMethod === 'sepa_debit' ? 'eur' : 'usd', // SEPA requires EUR
      countryCode: paymentMethod === 'sepa_debit' ? 'DE' : 'US', // Set appropriate country
      email: 'test@example.com',
      paymentMethodTypes: [paymentMethod]
    };
    
    console.log(`Sending request to ${API_URL}/api/payments/create-stripe-checkout`);
    console.log('Request data:', JSON.stringify(data, null, 2));
    
    const response = await axios.post(`${API_URL}/api/payments/create-stripe-checkout`, data);
    console.log(`✅ Success! Status: ${response.status}`);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
    
    return response.data;
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error('Error data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('No response received. Is the server running?');
    }
    
    throw error;
  }
}

async function runTests() {
  try {
    // Test card payment (default method)
    await testStripeCheckout('card');
    
    // Test SEPA Direct Debit
    await testStripeCheckout('sepa_debit');
    
    console.log('\n✅ All tests completed successfully!');
  } catch (error) {
    console.error('\n❌ Test suite failed');
  }
}

// Run the tests
runTests(); 