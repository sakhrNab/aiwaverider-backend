const axios = require('axios');

const API_URL = 'http://localhost:4000';

// Mock payment tokens for testing
const MOCK_GOOGLE_PAY_TOKEN = JSON.stringify({
  id: 'tok_visa', // Using Stripe's test token
  object: 'token',
  card: {
    brand: 'visa',
    last4: '4242',
    exp_month: 12,
    exp_year: 2025
  }
});

const MOCK_APPLE_PAY_PAYMENT = {
  token: {
    id: 'tok_visa', // Using Stripe's test token
    object: 'token',
    card: {
      brand: 'visa',
      last4: '4242',
      exp_month: 12,
      exp_year: 2025
    }
  }
};

async function testDirectWallets() {
  console.log('=== Testing Direct Digital Wallet Integrations ===');
  
  // Test data
  const testData = {
    amount: 19.99,
    items: [
      {
        id: 'test-product-1',
        title: 'Test Product',
        description: 'A test product for digital wallet integration',
        price: 19.99,
        quantity: 1
      }
    ],
    email: 'test@example.com',
    currency: 'usd',
    countryCode: 'US'
  };
  
  // Test Google Pay
  console.log('\n--- Testing Direct Google Pay Integration ---');
  try {
    const googlePayData = {
      ...testData,
      paymentToken: MOCK_GOOGLE_PAY_TOKEN
    };
    
    console.log('Request data:', JSON.stringify(googlePayData, null, 2));
    
    const googlePayResponse = await axios.post(
      `${API_URL}/api/payments/process-google-pay`,
      googlePayData
    );
    
    console.log('Google Pay Test Result:');
    console.log('Status:', googlePayResponse.status);
    console.log('Success:', googlePayResponse.data.success);
    console.log('Order ID:', googlePayResponse.data.orderId);
    console.log('Payment Status:', googlePayResponse.data.status);
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
  console.log('\n--- Testing Direct Apple Pay Integration ---');
  try {
    const applePayData = {
      ...testData,
      payment: MOCK_APPLE_PAY_PAYMENT
    };
    
    console.log('Request data:', JSON.stringify(applePayData, null, 2));
    
    const applePayResponse = await axios.post(
      `${API_URL}/api/payments/process-apple-pay`,
      applePayData
    );
    
    console.log('Apple Pay Test Result:');
    console.log('Status:', applePayResponse.status);
    console.log('Success:', applePayResponse.data.success);
    console.log('Order ID:', applePayResponse.data.orderId);
    console.log('Payment Status:', applePayResponse.data.status);
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
testDirectWallets().catch(error => {
  console.error('Test suite failed:', error.message);
}); 