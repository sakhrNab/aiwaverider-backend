// Simple test script for the chat API
const fetch = require('node-fetch');

async function testChatAPI() {
  try {
    console.log('Testing chat API...');
    
    const response = await fetch('http://localhost:4000/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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

testChatAPI();
