const { Configuration, OpenAIApi } = require('openai');
// Alternate import for newer versions of OpenAI SDK
// const OpenAI = require('openai');

// Import the newer OpenAI SDK
const OpenAI = require('openai');

/**
 * Process chat messages with OpenAI
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.processChat = async (req, res) => {
  try {
    console.log('Chat API request received');
    const { messages } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      console.error('Invalid request format: messages array is missing or not an array');
      return res.status(400).json({
        success: false,
        error: 'Invalid request format. Messages array is required.'
      });
    }
    
    console.log(`Processing ${messages.length} messages`);
    
    // Initial system message for the assistant to help with website navigation
    const systemMessage = {
      role: "system",
      content: `You are a helpful AI assistant for the AI Waverider website. Your purpose is to assist users in navigating the site, understanding our offerings, and answering questions.

Key information about AI Waverider:
- We offer AI monetization training to help people earn $2,000-$10,000/month
- Our key offerings include Training Portal, Private Online Community, Live Online Classes, and Software tools (Convertwave & Remixer)
- We have 7 proven monetization paths: Software Referral, Setup/Build Fees, Monthly Retainer, Consulting, Profit Sharing, Equity Deals, and Affiliate/Referral Program
- We help users overcome common obstacles like technical complexity, time constraints, too many choices, client acquisition, pricing, and lack of support
- Our program is designed to be accessible for non-technical people

Available pages:
- HomePage: Overview of all offerings and features
- Monetization Paths: Detailed information on the 7 ways to monetize AI
- AITools: Browse tools that help with AI implementation
- Profile: User account management
- Checkout: Payment processing

Remember to be friendly, helpful, and concise in your responses. If someone has technical questions or wants specific pricing details, encourage them to book a strategy call or try our free trial. Keep responses under 3 sentences when possible.`
    };
    
    // Check for OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      console.error('OpenAI API key not found in environment variables');
      return res.status(500).json({
        success: false,
        error: 'OpenAI API key not configured'
      });
    }

    console.log('Initializing OpenAI client');
    
    // Use new OpenAI SDK
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    console.log('Making request to OpenAI API with model: gpt-4o-mini');
    
    // Create the messages array with system message first
    const fullMessages = [
      systemMessage,
      ...messages
    ];
    
    console.log('Sending request to OpenAI with message count:', fullMessages.length);
    
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: fullMessages,
      max_tokens: 300,
      temperature: 0.7
    });
    
    console.log('Received response from OpenAI API');
    
    const assistantMessage = completion.choices[0].message.content;
    
    console.log('Sending successful response back to client');
    
    return res.status(200).json({
      success: true,
      message: assistantMessage
    });
    
  } catch (error) {
    console.error('Chat API error:', error);
    
    // Log detailed error information
    if (error.response) {
      console.error('OpenAI API Error Status:', error.response.status);
      console.error('OpenAI API Error Data:', error.response.data);
    } else {
      console.error('Error details:', error.message);
      console.error('Error stack:', error.stack);
    }
    
    // Handle specific OpenAI errors
    if (error.response) {
      return res.status(error.response.status || 500).json({
        success: false,
        error: error.response.data.error.message || 'OpenAI API error',
        details: error.response.data
      });
    }
    
    return res.status(500).json({
      success: false,
      error: 'Failed to process chat message',
      details: error.message
    });
  }
}; 