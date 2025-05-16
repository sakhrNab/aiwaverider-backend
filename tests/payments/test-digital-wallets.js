const axios = require('axios');

const API_URL = 'http://localhost:4000';

async function testDigitalWallets() {
  console.log('=== Testing Digital Wallet Integrations ===');
  
  // Test data with properly formatted line items for Stripe
  const testData = {
    cartTotal: 19.99,
    items: [
      {
        id: 'test-product-1',
        title: 'Test Product',
        description: 'A test product for digital wallet integration',
        price: 19.99,
        quantity: 1,
        imageUrl: 'https://via.placeholder.com/150'
      }
    ],
    email: 'test@example.com'
  };
  
  // Test Google Pay
  console.log('\n--- Testing Google Pay Integration ---');
  try {
    const googlePayData = {
      ...testData,
      currency: 'usd',
      countryCode: 'US',
      paymentMethodTypes: ['card'] // Google Pay works through card payment method
    };
    
    console.log('Request data:', JSON.stringify(googlePayData, null, 2));
    
    const googlePayResponse = await axios.post(
      `${API_URL}/api/payments/create-stripe-checkout`,
      googlePayData
    );
    
    console.log('Google Pay Test Result:');
    console.log('Status:', googlePayResponse.status);
    console.log('URL:', googlePayResponse.data.url);
    console.log('Session ID:', googlePayResponse.data.id);
    console.log('Google Pay test successful ✅');
  } catch (error) {
    console.error('Google Pay Test Failed ❌');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  }
  
  // Test Apple Pay
  console.log('\n--- Testing Apple Pay Integration ---');
  try {
    const applePayData = {
      ...testData,
      currency: 'usd',
      countryCode: 'US',
      paymentMethodTypes: ['card'] // Apple Pay works through card payment method
    };
    
    console.log('Request data:', JSON.stringify(applePayData, null, 2));
    
    const applePayResponse = await axios.post(
      `${API_URL}/api/payments/create-stripe-checkout`,
      applePayData
    );
    
    console.log('Apple Pay Test Result:');
    console.log('Status:', applePayResponse.status);
    console.log('URL:', applePayResponse.data.url);
    console.log('Session ID:', applePayResponse.data.id);
    console.log('Apple Pay test successful ✅');
  } catch (error) {
    console.error('Apple Pay Test Failed ❌');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    } else {
      console.error('Error:', error.message);
    }
  }
}

// Run the tests
testDigitalWallets().catch(error => {
  console.error('Test suite failed:', error.message);
}); 