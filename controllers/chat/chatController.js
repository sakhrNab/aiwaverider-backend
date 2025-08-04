// Import the newer OpenAI SDK
const OpenAI = require('openai');

/**
 * Process chat messages with OpenAI
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
exports.processChat = async (req, res) => {
  try {
    
    const { messages } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      console.error('Invalid request format: messages array is missing or not an array');
      return res.status(400).json({
        success: false,
        error: 'Invalid request format. Messages array is required.'
      });
    }
        
    // Enhanced system message with booking detection and updated information
    const systemMessage = {
      role: "system",
      content: `You are a helpful AI assistant for the AI Waverider website. Your purpose is to assist users in navigating the site, understanding our offerings, and answering questions.

Key information about AI Waverider:
- We help people build profitable AI businesses earning $5,000-$25,000/month through proven strategies
- Our main offerings include: Training Portal, Private Online Community, Live Online Classes, and AI-powered software tools
- We create AI-powered video editing tools, automated workflows using AI, and other cutting-edge AI solutions
- We have 4 proven monetization paths:
  1. AI Tool Affiliate Marketing ($2,000-$15,000/month)
  2. n8n Automation Workflows ($3,000-$20,000/month) 
  3. AI Consulting Services ($8,000-$50,000/month)
  4. Teaching & Training Programs ($5,000-$100,000/month)
- We help users overcome common obstacles like technical complexity, time constraints, client acquisition, pricing, and scaling
- Our program is designed to be accessible for non-technical people
- We're located in Tbilisi, Georgia and offer services globally in multiple languages (Arabic, German, English, Spanish)

Available pages:
- HomePage: Overview of all offerings and features
- Monetization Paths: Detailed information on the 4 ways to monetize AI
- AITools: Browse tools that help with AI implementation
- Profile: User account management
- Checkout: Payment processing

CRITICAL BOOKING INSTRUCTIONS - ALWAYS FOLLOW THESE:
When a user mentions ANY of these phrases or similar requests, you MUST include [SHOW_BOOKING_BUTTON] at the end:
- "book an appointment"
- "schedule" anything
- "can I book" 
- "book a call"
- "speak with someone"
- "talk to someone"
- "consultation"
- "meeting"
- "strategy call"
- "contact you"
- "get in touch"
- "speak to an agent"
- "talk to a person"
- "human support"
- "call me"
- "phone call"
- Questions about appointments, bookings, or scheduling

ALWAYS respond with enthusiasm about booking and include [SHOW_BOOKING_BUTTON]. Examples:
- User: "can i book an appointment?" → "Absolutely! I'd love to help you schedule a free strategy call with our founder Sakhr Al-Absi. [SHOW_BOOKING_BUTTON]"
- User: "book an appointment for me" → "Perfect! Let me help you book a free 30-minute strategy call to discuss your AI business goals. [SHOW_BOOKING_BUTTON]"

Remember: EVERY booking-related request should get [SHOW_BOOKING_BUTTON] - no exceptions!`
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
      max_tokens: 400,
      temperature: 0.7
    });
    
    const assistantMessage = completion.choices[0].message.content;
    
    // Check if the response contains the booking button marker
    const shouldShowBookingButton = assistantMessage.includes('[SHOW_BOOKING_BUTTON]');
    
    // Clean the message by removing the marker
    const cleanMessage = assistantMessage.replace('[SHOW_BOOKING_BUTTON]', '').trim();
    
    return res.status(200).json({
      success: true,
      message: cleanMessage,
      showBookingButton: shouldShowBookingButton
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