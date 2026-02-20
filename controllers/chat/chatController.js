// Import the newer OpenAI SDK
const OpenAI = require('openai');
const { searchRelevant } = require('../../services/rag/qdrantService');
const { pool } = require('../../config/database');

// Create OpenAI client once at module level
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

/**
 * Look up missing detail-page data from PostgreSQL so the chatbot
 * always knows which product the user is viewing.
 */
async function resolvePageContext(pageContext) {
  if (!pageContext?.data) return pageContext;

  try {
    const { page, data } = pageContext;

    if (page === 'agent-detail' && data.agentId && !data.agentName) {
      const { rows } = await pool.query(
        'SELECT name, price, category, description FROM agents WHERE id = $1 LIMIT 1',
        [data.agentId]
      );
      if (rows[0]) {
        data.agentName = rows[0].name;
        data.agentPrice = rows[0].price;
        data.agentCategory = rows[0].category;
        data.agentDescription = (rows[0].description || '').slice(0, 200);
      }
    }

    if (page === 'app-detail' && data.appId && !data.appTitle) {
      const { rows } = await pool.query(
        'SELECT title, price, category, description FROM apps WHERE id = $1 LIMIT 1',
        [data.appId]
      );
      if (rows[0]) {
        data.appTitle = rows[0].title;
        data.appPrice = rows[0].price;
        data.appCategory = rows[0].category;
      }
    }

    if (page === 'prompt-detail' && data.promptId && !data.promptName) {
      const { rows } = await pool.query(
        'SELECT title, category, description FROM prompts WHERE id = $1 LIMIT 1',
        [data.promptId]
      );
      if (rows[0]) {
        data.promptName = rows[0].title;
      }
    }

    if (page === 'post-detail' && data.postId && !data.postTitle) {
      const { rows } = await pool.query(
        'SELECT title, category, description FROM posts WHERE id = $1 LIMIT 1',
        [data.postId]
      );
      if (rows[0]) {
        data.postTitle = rows[0].title;
        data.postCategory = rows[0].category;
        data.postDescription = (rows[0].description || '').slice(0, 200);
      }
    }
  } catch (err) {
    // Non-critical — chatbot still works without enrichment
    console.warn('resolvePageContext lookup failed:', err.message);
  }

  return pageContext;
}

/**
 * Sanitize messages from the client before sending to OpenAI.
 * - Only allow 'user' and 'assistant' roles (block 'system' injection)
 * - Truncate overly long messages
 * - Limit conversation history length
 */
function sanitizeMessages(messages) {
  const MAX_MESSAGES = 30;
  const MAX_MSG_LENGTH = 2000;

  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-MAX_MESSAGES)
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, MAX_MSG_LENGTH) : '',
    }));
}

// ── OpenAI Function Calling Tools ────────────────────────────────────

const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_articles',
      description: 'Search for news articles and blog posts on the site. Call this when the user asks about news, articles, blog posts, latest tech, or "what\'s new". Do NOT use this for workflows, prompts, or apps.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search keywords' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_workflows',
      description: 'Search for N8N automation workflows available for purchase. Call this when the user asks about workflows, automations, bots, n8n templates, or agents to buy. These are PRODUCTS, not news.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search keywords' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_prompts',
      description: 'Search for AI prompts available for purchase. Call this when the user asks about prompts, prompt templates, ChatGPT prompts, or Midjourney prompts. These are PRODUCTS, not news.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search keywords' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_apps',
      description: 'Search for AI apps and tools built by AI Waverider. Call this when the user asks about our apps, software, or production tools.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search keywords' } } },
    },
  },
];

// Map tool names to Qdrant collection names
const TOOL_COLLECTION_MAP = {
  search_articles: ['posts'],
  search_workflows: ['agents'],
  search_prompts: ['prompts'],
  search_apps: ['apps'],
};

/**
 * Execute a tool call by running a type-filtered RAG search.
 */
async function executeTool(name, args) {
  const collections = TOOL_COLLECTION_MAP[name];
  if (!collections) return 'Unknown tool.';

  const query = args.query || 'popular';
  const results = await searchRelevant(query, 6, collections).catch((err) => {
    console.warn(`Tool ${name} search failed:`, err.message);
    return [];
  });

  if (!results.length) return `No results found.`;

  return results.map((r) => {
    let line = `- [${r.type}] ${r.name}`;
    if (r.description) line += `: ${r.description}`;
    if (r.category) line += ` (Category: ${r.category})`;
    if (r.price !== undefined && r.price > 0) line += ` — $${r.price}`;
    if (r.is_free) line += ' — FREE';
    if (r.url_path) line += ` | Link: ${r.url_path}`;
    return line;
  }).join('\n') + '\n\nALWAYS include clickable markdown links like [Title](url_path) when referencing these items.';
}

/**
 * Process tool calls from an OpenAI response and build follow-up messages.
 */
async function handleToolCalls(allMessages, toolCalls) {
  const assistantToolMsg = {
    role: 'assistant',
    content: null,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: { name: tc.name, arguments: tc.arguments },
    })),
  };

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

// ── System Prompt ────────────────────────────────────────────────────

const BASE_SYSTEM_PROMPT = `You are a helpful AI assistant for the AI Waverider website, founded by Sakhr Al-Absi (CS degree from TU Berlin, 7+ years enterprise experience, Fortune 500 background, hackathon winner). Your purpose is to assist users in navigating the site, understanding our offerings, and answering questions.

Key information about AI Waverider:
- We help people build production AI apps in 2-12 hours using Claude Code, Cursor, and N8N
- Sakhr built 6 production apps himself: AI WaveCut (video editor), FlowState (productivity), SRT Translator Pro (subtitles), AI Job Writer (resumes), Outbound AI (cold outreach), Email AI (automation)
- 5,600+ pre-built N8N AI workflows available for download
- 50+ AI prompts across categories (Code Generation, Content Writing, Marketing, Data Analysis, Images, Business Strategy)
- Free Skool community for learning and networking
- We have 4 proven monetization paths:
  1. AI App Development with Vibe Coding
  2. N8N Workflow Automation
  3. AI Tool Affiliate Marketing
  4. Teaching & Community Building
- B2B automation services available (discovery call, custom proposal, build & test, launch & support)
- Services offered globally in Arabic, German, English, and Spanish

Available pages and what they contain:
- Home (/): Hero section, founder credentials, tool stack (Claude Code + Cursor + N8N), 4 AI business models, 6 common challenges addressed, learning path, 6 apps showcase, agent library, FAQ
- About (/about): Mission statement, core values (Build First, Nobody Builds Alone, Speed Is the New Skill, Open by Default), founder bio, what we offer (6 apps, workflow marketplace, prompts, videos, community, B2B services)
- Agents/Workflows (/agents): Browse 5,600+ N8N AI workflows with search, filtering by category, and sorting
- AI Tools (/ai-tools): Curated directory of external third-party AI tools (NOT our own products — these are tools users can visit externally)
- Apps (/apps): Browse production AI apps and tools BUILT by AI Waverider (our own apps)
- Prompts (/prompts): Browse 50+ AI prompts for various use cases
- Posts/Tech News (/posts): Latest tech news, tutorials, and articles
- Videos (/videos): YouTube tutorials, build-alongs, tool reviews, launch demos
- Media Kit (/media-kit): TikTok creator media kit — 167K peak views, 8.2% engagement, sponsorship packages (Promo Reel, Promo+Funnel, Campaign, Monthly Retainer), ROI calculator
- Business Media Kit (/media-kit-business): Full B2B platform media kit — platform stats, 6 production apps, featured workflows, service packages (Starter/Professional/Enterprise/Retainer), 200+ integrations, 9 industries automated
- Monetization Paths (/monetization-paths): Detailed breakdown of 4 ways to monetize AI
- Checkout (/checkout): Payment processing
- Profile (/profile): User account management

NAVIGATION GUIDANCE — use these to direct users to the correct page:
- For latest news, articles, or tutorials → direct to /posts
- For AI workflows/automations → direct to /agents
- For AI apps built by AI Waverider → direct to /apps
- For external third-party AI tools → direct to /ai-tools (NOT /prompts, NOT /apps)
- For AI prompts (text prompts for LLMs) → direct to /prompts
- For video content → direct to /videos
- For sponsorship or creator partnerships → direct to /media-kit
- For B2B services or enterprise partnerships → direct to /media-kit-business
- IMPORTANT: /ai-tools shows EXTERNAL tools (not ours). /apps shows OUR apps. /agents shows N8N WORKFLOWS. /prompts shows TEXT PROMPTS. Never confuse these pages.

YOU HAVE TOOLS to look up specific content types. Use them to give accurate answers:
- User asks about news/articles/blog posts → call search_articles
- User asks about workflows/automations/agents to buy → call search_workflows
- User asks about prompts to buy → call search_prompts
- User asks about our apps/software → call search_apps
- Do NOT mix content types. If a user asks about news, ONLY call search_articles — never search_workflows.
- ALWAYS include clickable markdown links like [Title](/path) when referencing items from tool results.
- For general questions (about AI Waverider, booking, pricing, etc.), answer directly without tools.

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

Remember: EVERY booking-related request should get [SHOW_BOOKING_BUTTON] - no exceptions!

LANGUAGE INSTRUCTIONS:
- Detect the language the user writes in and ALWAYS reply in that same language.
- If the user writes in German, reply in German. Arabic → Arabic. Spanish → Spanish. English → English.
- If unsure, default to English.
- Keep the same helpful, knowledgeable tone regardless of language.`;

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
        prompt += '\nThis page shows 5,600+ N8N AI workflows. Help them find the right one.';
        break;
      case 'prompts':
        if (pageContext.data && pageContext.data.currentSearch) {
          prompt += `\nThey searched for prompts: "${pageContext.data.currentSearch}"`;
        }
        prompt += '\nThis page shows 50+ AI prompts across categories like Code, Content, Marketing, Data, Images, and Business.';
        break;
      case 'prompt-detail':
        if (pageContext.data) {
          prompt += `\nThey are viewing a prompt called "${pageContext.data.promptName || 'unknown'}".`;
        }
        break;
      case 'ai-tools':
        prompt += '\nThis is the AI Tools Directory page. It shows a curated collection of EXTERNAL third-party AI tools (not our own products). These are external tools users can visit. Help them discover and compare AI tools for their needs. This is NOT the prompts page and NOT the apps page — it is a directory of external AI tools.';
        break;
      case 'apps':
        prompt += '\nThis page shows production AI apps and tools built by AI Waverider. Help them explore, compare, or understand the apps.';
        break;
      case 'app-detail':
        if (pageContext.data) {
          prompt += `\nThey are viewing an app called "${pageContext.data.appTitle || 'unknown'}".`;
          if (pageContext.data.appPrice) prompt += ` Price: $${pageContext.data.appPrice}.`;
          if (pageContext.data.appCategory) prompt += ` Category: ${pageContext.data.appCategory}.`;
          if (pageContext.data.appType) prompt += ` Type: ${pageContext.data.appType}.`;
          prompt += '\nAnswer questions about this specific app.';
        }
        break;
      case 'home':
        prompt += '\nThis is the homepage. It showcases the full platform: apps, workflows, prompts, community, and monetization paths. Help them discover what interests them.';
        break;
      case 'about':
        prompt += '\nThis is the About page. It covers the mission, values, founder Sakhr Al-Absi\'s background, and everything AI Waverider offers. Answer questions about the team, mission, or offerings.';
        break;
      case 'media-kit':
        prompt += '\nThis is the personal Media Kit page for TikTok creator sponsorships. It shows engagement metrics (167K peak views, 8.2% engagement), sponsorship packages, ROI calculator, and how brand partnerships work. Help with sponsorship questions.';
        break;
      case 'media-kit-business':
        prompt += '\nThis is the Business Media Kit page for B2B partnerships. It covers the full platform (apps, workflows, prompts, community), service packages (Starter to Enterprise), 200+ integrations, and industries served. Help with B2B and partnership questions.';
        break;
      case 'posts':
        prompt += '\nThis page shows tech news, tutorials, and articles. Help them find relevant content.';
        break;
      case 'post-detail':
        if (pageContext.data) {
          prompt += `\nThey are reading a post/article called "${pageContext.data.postTitle || 'unknown'}".`;
          if (pageContext.data.postCategory) prompt += ` Category: ${pageContext.data.postCategory}.`;
          if (pageContext.data.postDescription) prompt += `\nSummary: ${pageContext.data.postDescription}`;
          prompt += '\nAnswer questions about this specific post when asked.';
        }
        break;
      case 'checkout':
        prompt += '\nThey are on the checkout page. Help them with payment questions.';
        break;
      case 'videos':
        prompt += '\nThis page shows video tutorials, build-alongs, tool reviews, and launch demos.';
        break;
      case 'monetization-paths':
        prompt += '\nThis page details the 4 AI monetization paths: Vibe Coding Apps, N8N Automation, Affiliate Marketing, and Teaching. Help them choose the right path.';
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
      if (r.body_excerpt) prompt += `\n  Excerpt: ${r.body_excerpt}`;
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
    let { messages, pageContext } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format. Messages array is required.',
      });
    }

    if (!openai) {
      return res.status(500).json({
        success: false,
        error: 'OpenAI API key not configured',
      });
    }

    // Run page context enrichment and RAG search in parallel (independent DB/API calls)
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const [resolvedContext, ragResults] = await Promise.all([
      resolvePageContext(pageContext),
      lastUserMsg
        ? searchRelevant(lastUserMsg.content, 5).catch((err) => {
            console.warn('RAG search failed, continuing without:', err.message);
            return [];
          })
        : Promise.resolve([]),
    ]);
    pageContext = resolvedContext;

    const systemPrompt = buildSystemPrompt(pageContext, ragResults);
    const safeMessages = sanitizeMessages(messages);
    const fullMessages = [{ role: 'system', content: systemPrompt }, ...safeMessages];

    // First call — may return content or tool_calls
    const firstCompletion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: fullMessages,
      max_tokens: 800,
      temperature: 0.7,
      tools: CHAT_TOOLS,
    });

    const firstChoice = firstCompletion.choices[0];
    let assistantMessage;

    // If model called tools, execute them and make a second call
    if (firstChoice.finish_reason === 'tool_calls' && firstChoice.message.tool_calls) {
      const toolCalls = firstChoice.message.tool_calls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));
      const messagesWithTools = await handleToolCalls(fullMessages, toolCalls);

      const secondCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messagesWithTools,
        max_tokens: 800,
        temperature: 0.7,
      });
      assistantMessage = secondCompletion.choices[0].message.content || '';
    } else {
      assistantMessage = firstChoice.message.content || '';
    }

    const shouldShowBookingButton = assistantMessage.includes('[SHOW_BOOKING_BUTTON]');
    const cleanMessage = assistantMessage.replaceAll('[SHOW_BOOKING_BUTTON]', '').trim();

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
        error: error.response.data?.error?.message || 'OpenAI API error',
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
    let { messages, pageContext } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request format. Messages array is required.',
      });
    }

    if (!openai) {
      return res.status(500).json({
        success: false,
        error: 'OpenAI API key not configured',
      });
    }

    // Run page context enrichment and RAG search in parallel (independent DB/API calls)
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const [resolvedContext, ragResults] = await Promise.all([
      resolvePageContext(pageContext),
      lastUserMsg
        ? searchRelevant(lastUserMsg.content, 5).catch((err) => {
            console.warn('RAG search failed, continuing without:', err.message);
            return [];
          })
        : Promise.resolve([]),
    ]);
    pageContext = resolvedContext;

    const systemPrompt = buildSystemPrompt(pageContext, ragResults);
    const safeMessages = sanitizeMessages(messages);
    const fullMessages = [{ role: 'system', content: systemPrompt }, ...safeMessages];

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering
    res.flushHeaders();

    let clientDisconnected = false;
    req.on('close', () => { clientDisconnected = true; });

    // First stream — with tools
    const firstStream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: fullMessages,
      max_tokens: 800,
      temperature: 0.7,
      tools: CHAT_TOOLS,
      stream: true,
    });

    // Collect response — could be content or tool_calls
    const toolCallsMap = {};
    let hasToolCalls = false;

    for await (const chunk of firstStream) {
      if (clientDisconnected) break;
      const delta = chunk.choices[0]?.delta;

      if (delta?.tool_calls) {
        hasToolCalls = true;
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCallsMap[idx]) toolCallsMap[idx] = { id: '', name: '', arguments: '' };
          if (tc.id) toolCallsMap[idx].id = tc.id;
          if (tc.function?.name) toolCallsMap[idx].name = tc.function.name;
          if (tc.function?.arguments) toolCallsMap[idx].arguments += tc.function.arguments;
        }
      }

      // Stream content tokens directly
      if (delta?.content) {
        res.write(`data: ${JSON.stringify({ token: delta.content })}\n\n`);
      }
    }

    // If model called tools, execute and stream second response
    if (hasToolCalls && !clientDisconnected) {
      const toolCalls = Object.values(toolCallsMap);
      const messagesWithTools = await handleToolCalls(fullMessages, toolCalls);

      const secondStream = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messagesWithTools,
        max_tokens: 800,
        temperature: 0.7,
        stream: true,
      });

      for await (const chunk of secondStream) {
        if (clientDisconnected) break;
        const token = chunk.choices[0]?.delta?.content;
        if (token) {
          res.write(`data: ${JSON.stringify({ token })}\n\n`);
        }
      }
    }

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
