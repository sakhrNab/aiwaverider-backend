const OpenAI = require('openai');
const admin = require('firebase-admin');

const db = admin.firestore();

// ── Firestore helpers to fetch real content ──────────────────────────

async function fetchRecentPosts(limit = 10) {
  try {
    const snap = await db.collection('posts')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        title: d.title || '',
        description: (d.description || '').slice(0, 120),
        category: d.category || '',
      };
    });
  } catch (err) {
    console.error('fetchRecentPosts error:', err.message);
    return [];
  }
}

async function fetchRecentAgents(limit = 10) {
  try {
    const snap = await db.collection('agents')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        title: d.title || d.name || '',
        description: (d.description || '').slice(0, 120),
        category: d.category || (d.categories && d.categories[0]) || '',
        isFree: !!d.isFree,
      };
    });
  } catch (err) {
    console.error('fetchRecentAgents error:', err.message);
    return [];
  }
}

async function fetchRecentPrompts(limit = 10) {
  try {
    const snap = await db.collection('prompts')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        title: d.title || '',
        description: (d.description || '').slice(0, 120),
        category: d.category || '',
      };
    });
  } catch (err) {
    console.error('fetchRecentPrompts error:', err.message);
    return [];
  }
}

async function fetchRecentAITools(limit = 10) {
  try {
    const snap = await db.collection('ai_tools')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        title: d.title || '',
        description: (d.description || '').slice(0, 120),
        link: d.link || d.url || '',
        tags: d.tags || [],
      };
    });
  } catch (err) {
    console.error('fetchRecentAITools error:', err.message);
    return [];
  }
}

async function fetchRecentVideos(limit = 10) {
  try {
    const snap = await db.collection('videos')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id,
        title: d.title || '',
        platform: d.platform || '',
        authorName: d.authorName || '',
        originalUrl: d.originalUrl || '',
      };
    });
  } catch (err) {
    console.error('fetchRecentVideos error:', err.message);
    return [];
  }
}

// ── OpenAI Tool Definitions ──────────────────────────────────────────

const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_articles',
      description: 'Search for news articles and blog posts on the AI Waverider site. Call this when the user asks about news, articles, blog posts, latest tech, or "what\'s new". Do NOT use this for workflows or prompts.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional keywords to filter articles by topic',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_workflows',
      description: 'Search for automation workflows and n8n agents available for purchase on the marketplace. Call this when the user asks about workflows, automations, bots, n8n templates, or products to buy. These are PRODUCTS, not news articles.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional keywords to filter workflows',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_prompts',
      description: 'Search for AI prompts available for purchase. Call this when the user asks about prompts, prompt templates, ChatGPT prompts, or Midjourney prompts. These are PRODUCTS, not news articles.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional keywords to filter prompts',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_ai_tools',
      description: 'Search the AI tools directory of external third-party tools and software. Call this when the user asks about AI tools, external services, or software recommendations.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional keywords to filter tools',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_videos',
      description: 'Search video tutorials (YouTube, TikTok, Instagram). Call this when the user asks about video tutorials, how-to videos, or learning content.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Optional keywords to filter videos',
          },
        },
      },
    },
  },
];

// ── Tool Execution ───────────────────────────────────────────────────

async function executeTool(name, args) {
  switch (name) {
    case 'search_articles': {
      const posts = await fetchRecentPosts();
      if (!posts.length) return 'No articles found on the site right now.';
      return 'NEWS ARTICLES (blog posts):\n' + posts.map(p =>
        `- "${p.title}" [${p.category}] — link: /posts/${p.id}`
      ).join('\n') + '\n\nIMPORTANT: Always include a clickable markdown link like [Article Title](/posts/id) when referencing an article.';
    }
    case 'search_workflows': {
      const agents = await fetchRecentAgents();
      if (!agents.length) return 'No workflows found on the marketplace right now.';
      return 'AUTOMATION WORKFLOWS FOR SALE:\n' + agents.map(a =>
        `- "${a.title}" [${a.category}${a.isFree ? ', FREE' : ''}] — link: /agents/${a.id}`
      ).join('\n') + '\n\nIMPORTANT: Always include a clickable markdown link like [Workflow Title](/agents/id) when referencing a workflow.';
    }
    case 'search_prompts': {
      const prompts = await fetchRecentPrompts();
      if (!prompts.length) return 'No prompts found on the marketplace right now.';
      return 'PROMPTS FOR SALE:\n' + prompts.map(p =>
        `- "${p.title}" [${p.category}] — link: /prompts/${p.id}`
      ).join('\n') + '\n\nIMPORTANT: Always include a clickable markdown link like [Prompt Title](/prompts/id) when referencing a prompt.';
    }
    case 'search_ai_tools': {
      const tools = await fetchRecentAITools();
      if (!tools.length) return 'No AI tools found in the directory right now.';
      return 'AI TOOLS DIRECTORY (external third-party tools):\n' + tools.map(t =>
        `- "${t.title}"${t.tags.length ? ` [${t.tags.slice(0, 3).join(', ')}]` : ''}${t.link ? ` — external link: ${t.link}` : ''}`
      ).join('\n') + '\n\nThese are external tools. Share the external link when available. Users can browse all tools at /ai-tools.';
    }
    case 'search_videos': {
      const videos = await fetchRecentVideos();
      if (!videos.length) return 'No videos found right now.';
      return 'VIDEO TUTORIALS:\n' + videos.map(v =>
        `- "${v.title}" [${v.platform}${v.authorName ? `, by ${v.authorName}` : ''}]${v.originalUrl ? ` — watch: ${v.originalUrl}` : ''}`
      ).join('\n') + '\n\nShare original URLs when available. Users can browse all videos at /videos.';
    }
    default:
      return 'Unknown tool.';
  }
}

// ── System Prompt (no content pre-loaded — tools handle retrieval) ───

const BASE_SYSTEM_PROMPT = `You are a helpful AI assistant for the AI Waverider website (https://aiwaverider.com). Your purpose is to assist users in navigating the site, understanding our offerings, and answering questions.

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

Website pages:
- Home: /
- Latest Tech News: /latest-tech
- AI Agents marketplace: /agents
- Prompts marketplace: /prompts
- AI Tools directory: /ai-tools
- Video Tutorials: /videos
- Monetization Paths: /monetization-paths
- About: /about

YOU HAVE TOOLS to look up site content. Use them:
- User asks about news/articles/blog posts → call search_articles
- User asks about workflows/automations/agents to buy → call search_workflows
- User asks about prompts → call search_prompts
- User asks about AI tools/software → call search_ai_tools
- User asks about videos/tutorials → call search_videos

IMPORTANT RULES:
- ALWAYS use the appropriate tool to look up content before referencing it. Do NOT make up links or IDs.
- ALWAYS include clickable markdown links when referencing specific content (e.g., [Title](/posts/id)).
- Do NOT mix content types. If a user asks about news, only call search_articles — do NOT also call search_workflows.
- If the user's question is general (about AI Waverider, pricing, booking, etc.), answer directly without calling tools.
- For simple questions like "hi" or "how are you", just respond conversationally — no need to call tools.

CRITICAL BOOKING INSTRUCTIONS - ALWAYS FOLLOW THESE:
When a user mentions ANY of these phrases or similar requests, you MUST include [SHOW_BOOKING_BUTTON] at the end:
- "book an appointment", "schedule", "can I book", "book a call"
- "speak with someone", "talk to someone", "consultation", "meeting"
- "strategy call", "contact you", "get in touch"
- "speak to an agent", "talk to a person", "human support"
- "call me", "phone call"
- Questions about appointments, bookings, or scheduling

ALWAYS respond with enthusiasm about booking and include [SHOW_BOOKING_BUTTON]. Examples:
- User: "can i book an appointment?" → "Absolutely! I'd love to help you schedule a free strategy call with our founder Sakhr Al-Absi. [SHOW_BOOKING_BUTTON]"
- User: "book an appointment for me" → "Perfect! Let me help you book a free 30-minute strategy call to discuss your AI business goals. [SHOW_BOOKING_BUTTON]"

Remember: EVERY booking-related request should get [SHOW_BOOKING_BUTTON] - no exceptions!`;

// ── Build system message with lightweight page hint ──────────────────

function buildSystemMessage(pageContext) {
  let content = BASE_SYSTEM_PROMPT;
  if (pageContext && pageContext.pageTitle) {
    content += `\n\nThe user is currently on the "${pageContext.pageTitle}" page.`;
  }
  return { role: 'system', content };
}

// ── Helper: validate request ─────────────────────────────────────────

function validateRequest(req, res) {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({
      success: false,
      error: 'Invalid request format. Messages array is required.',
    });
    return null;
  }
  if (!process.env.OPENAI_API_KEY) {
    res.status(500).json({ success: false, error: 'OpenAI API key not configured' });
    return null;
  }
  return messages;
}

// ── Helper: handle tool calls in a conversation ──────────────────────

async function handleToolCalls(openai, allMessages, toolCalls) {
  // Build the assistant message that triggered tool calls
  const assistantToolMsg = {
    role: 'assistant',
    content: null,
    tool_calls: toolCalls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments },
    })),
  };

  // Execute each tool and build result messages
  const toolResultMessages = [];
  for (const tc of toolCalls) {
    let args = {};
    try { args = JSON.parse(tc.arguments || '{}'); } catch (_) {}
    const result = await executeTool(tc.name, args);
    toolResultMessages.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: result,
    });
  }

  return [...allMessages, assistantToolMsg, ...toolResultMessages];
}

// ── Non-streaming endpoint: POST /api/chat ───────────────────────────

exports.processChat = async (req, res) => {
  try {
    const messages = validateRequest(req, res);
    if (!messages) return;

    const { pageContext } = req.body;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const systemMessage = buildSystemMessage(pageContext);
    const allMessages = [systemMessage, ...messages];

    // First call — may return content or tool_calls
    const firstCompletion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: allMessages,
      max_tokens: 600,
      temperature: 0.7,
      tools: CHAT_TOOLS,
    });

    const firstChoice = firstCompletion.choices[0];

    // If model called tools, execute them and make a second call
    if (firstChoice.finish_reason === 'tool_calls' && firstChoice.message.tool_calls) {
      const toolCalls = firstChoice.message.tool_calls.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));

      const messagesWithTools = await handleToolCalls(openai, allMessages, toolCalls);

      // Second call — no tools, just generate the final answer
      const secondCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messagesWithTools,
        max_tokens: 600,
        temperature: 0.7,
      });

      const assistantMessage = secondCompletion.choices[0].message.content;
      const shouldShowBookingButton = assistantMessage.includes('[SHOW_BOOKING_BUTTON]');
      const cleanMessage = assistantMessage.replaceAll('[SHOW_BOOKING_BUTTON]', '').trim();

      return res.status(200).json({
        success: true,
        message: cleanMessage,
        showBookingButton: shouldShowBookingButton,
      });
    }

    // No tool calls — direct response
    const assistantMessage = firstChoice.message.content || '';
    const shouldShowBookingButton = assistantMessage.includes('[SHOW_BOOKING_BUTTON]');
    const cleanMessage = assistantMessage.replaceAll('[SHOW_BOOKING_BUTTON]', '').trim();

    return res.status(200).json({
      success: true,
      message: cleanMessage,
      showBookingButton: shouldShowBookingButton,
    });
  } catch (error) {
    console.error('Chat API error:', error.message);
    if (error.response) {
      return res.status(error.response.status || 500).json({
        success: false,
        error: error.response.data?.error?.message || 'OpenAI API error',
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Failed to process chat message',
    });
  }
};

// ── Streaming endpoint: POST /api/chat/stream ────────────────────────

exports.processChatStream = async (req, res) => {
  try {
    const messages = validateRequest(req, res);
    if (!messages) return;

    const { pageContext } = req.body;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const systemMessage = buildSystemMessage(pageContext);
    const allMessages = [systemMessage, ...messages];

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let aborted = false;
    req.on('close', () => { aborted = true; });

    // First call — stream with tools
    const firstStream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: allMessages,
      max_tokens: 600,
      temperature: 0.7,
      tools: CHAT_TOOLS,
      stream: true,
    });

    // Collect the response — could be content tokens or tool_calls
    let toolCallsMap = {};
    let hasToolCalls = false;

    for await (const chunk of firstStream) {
      if (aborted) break;
      const delta = chunk.choices[0]?.delta;

      // Accumulate tool calls from delta chunks
      if (delta?.tool_calls) {
        hasToolCalls = true;
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallsMap[idx]) {
            toolCallsMap[idx] = { id: '', name: '', arguments: '' };
          }
          if (tc.id) toolCallsMap[idx].id = tc.id;
          if (tc.function?.name) toolCallsMap[idx].name = tc.function.name;
          if (tc.function?.arguments) toolCallsMap[idx].arguments += tc.function.arguments;
        }
      }

      // Stream content tokens directly to client
      if (delta?.content) {
        res.write(`data: ${JSON.stringify({ token: delta.content })}\n\n`);
      }
    }

    // If model called tools, execute them and stream a second response
    if (hasToolCalls && !aborted) {
      const toolCalls = Object.values(toolCallsMap);
      const messagesWithTools = await handleToolCalls(openai, allMessages, toolCalls);

      // Second stream — final answer with tool results, no tools offered
      const secondStream = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messagesWithTools,
        max_tokens: 600,
        temperature: 0.7,
        stream: true,
      });

      for await (const chunk of secondStream) {
        if (aborted) break;
        const token = chunk.choices[0]?.delta?.content;
        if (token) {
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      }
    }

    if (!aborted) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (error) {
    console.error('Chat stream error:', error.message);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to process chat stream',
      });
    }
  }
};
