// Test file to emulate the browser request
const fetch = require('node-fetch');

async function testBrowserRequest() {
  try {
    console.log('Testing chat API with browser-like request...');
    
    // This is similar to what the browser would send, but directly to port 4000
    const response = await fetch('http://localhost:4000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:5173' // This simulates the browser origin
      },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Hello, this is a test message.' }
        ],
      }),
    });
    
    console.log('API Response Status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('API Error Response:', errorText);
      throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    console.log('API Response Data:', data);
    
  } catch (error) {
    console.error('Error testing chat API:', error);
  }
}

testBrowserRequest();
