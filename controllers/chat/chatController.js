// Import the newer OpenAI SDK
const OpenAI = require('openai');
const { searchRelevant } = require('../../services/rag/qdrantService');

const BASE_SYSTEM_PROMPT = `You are a helpful AI assistant for the AI Waverider website. Your purpose is to assist users in navigating the site, understanding our offerings, and answering questions.

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
- User: "can i book an appointment?" -> "Absolutely! I'd love to help you schedule a free strategy call with our founder Sakhr Al-Absi. [SHOW_BOOKING_BUTTON]"
- User: "book an appointment for me" -> "Perfect! Let me help you book a free 30-minute strategy call to discuss your AI business goals. [SHOW_BOOKING_BUTTON]"

Remember: EVERY booking-related request should get [SHOW_BOOKING_BUTTON] - no exceptions!`;

/**
 * Build a dynamic system prompt enriched with page context and RAG results.
 */
function buildSystemPrompt(pageContext, ragResults) {
  let prompt = BASE_SYSTEM_PROMPT;

  // Add page-specific context
  if (pageContext && pageContext.page) {
    prompt += '\n\n--- CURRENT PAGE CONTEXT ---';
    prompt += `\nThe user is currently on: ${pageContext.pageTitle || pageContext.page}`;

    switch (pageContext.page) {
      case 'agent-detail':
        if (pageContext.data) {
          prompt += `\nThey are viewing an agent called "${pageContext.data.agentName || 'unknown'}".`;
          if (pageContext.data.agentPrice) prompt += ` Price: $${pageContext.data.agentPrice}.`;
          if (pageContext.data.agentCategory) prompt += ` Category: ${pageContext.data.agentCategory}.`;
          prompt += '\nAnswer questions about this specific agent when asked.';
        }
        break;
      case 'agents':
        if (pageContext.data) {
          if (pageContext.data.currentSearch) prompt += `\nThey searched for: "${pageContext.data.currentSearch}"`;
          if (pageContext.data.currentCategory) prompt += `\nFiltered by category: "${pageContext.data.currentCategory}"`;
        }
        break;
      case 'prompts':
        if (pageContext.data && pageContext.data.currentSearch) {
          prompt += `\nThey searched for prompts: "${pageContext.data.currentSearch}"`;
        }
        break;
      case 'prompt-detail':
        if (pageContext.data) {
          prompt += `\nThey are viewing a prompt called "${pageContext.data.promptName || 'unknown'}".`;
        }
        break;
      case 'checkout':
        prompt += '\nThey are on the checkout page. Help them with payment questions.';
        break;
      default:
        break;
    }
  }

  // Add RAG results
  if (ragResults && ragResults.length > 0) {
    prompt += '\n\n--- RELEVANT PRODUCTS/CONTENT FROM OUR DATABASE ---';
    prompt += '\nUse the following information to give accurate, specific answers:';
    for (const r of ragResults) {
      prompt += `\n- [${r.type}] ${r.name}`;
      if (r.description) prompt += `: ${r.description}`;
      if (r.category) prompt += ` (Category: ${r.category})`;
      if (r.price !== undefined && r.price > 0) prompt += ` — $${r.price}`;
      if (r.is_free) prompt += ' — FREE';
      if (r.url_path) prompt += ` | Link: ${r.url_path}`;
    }
  }

  return prompt;
}

/**
 * Process chat messages with OpenAI (non-streaming, backwards-compatible).
 */
exports.processChat = async (req, res) => {
  try {
    const { messages, pageContext } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format. Messages array is required.',
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'OpenAI API key not configured',
      });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // RAG search based on last user message
    let ragResults = [];
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      try {
        ragResults = await searchRelevant(lastUserMsg.content, 5);
      } catch (err) {
        console.warn('RAG search failed, continuing without:', err.message);
      }
    }

    const systemPrompt = buildSystemPrompt(pageContext, ragResults);

    const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: fullMessages,
      max_tokens: 800,
      temperature: 0.7,
    });

    const assistantMessage = completion.choices[0].message.content;
    const shouldShowBookingButton = assistantMessage.includes('[SHOW_BOOKING_BUTTON]');
    const cleanMessage = assistantMessage.replace('[SHOW_BOOKING_BUTTON]', '').trim();

    return res.status(200).json({
      success: true,
      message: cleanMessage,
      showBookingButton: shouldShowBookingButton,
    });
  } catch (error) {
    console.error('Chat API error:', error);

    if (error.response) {
      return res.status(error.response.status || 500).json({
        success: false,
        error: error.response.data.error.message || 'OpenAI API error',
        details: error.response.data,
      });
    }

    return res.status(500).json({
      success: false,
      error: 'Failed to process chat message',
      details: error.message,
    });
  }
};

/**
 * Process chat messages with SSE streaming.
 */
exports.processChatStream = async (req, res) => {
  try {
    const { messages, pageContext } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format. Messages array is required.',
      });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({
        success: false,
        error: 'OpenAI API key not configured',
      });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // RAG search based on last user message
    let ragResults = [];
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      try {
        ragResults = await searchRelevant(lastUserMsg.content, 5);
      } catch (err) {
        console.warn('RAG search failed, continuing without:', err.message);
      }
    }

    const systemPrompt = buildSystemPrompt(pageContext, ragResults);
    const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
    res.flushHeaders();

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: fullMessages,
      max_tokens: 800,
      temperature: 0.7,
      stream: true,
    });

    // Handle client disconnect
    let clientDisconnected = false;
    req.on('close', () => {
      clientDisconnected = true;
    });

    for await (const chunk of stream) {
      if (clientDisconnected) break;

      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        res.write(`data: ${JSON.stringify({ token: delta })}\n\n`);
      }
    }

    // Signal completion
    if (!clientDisconnected) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (error) {
    console.error('Chat stream error:', error);

    // If headers haven't been sent yet, return JSON error
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: 'Failed to process chat stream',
        details: error.message,
      });
    }

    // Headers already sent (SSE started), send error as SSE event
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
};
