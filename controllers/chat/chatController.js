const OpenAI = require('openai');
const admin = require('firebase-admin');

const db = admin.firestore();

// ── Firestore helpers to fetch real content ──────────────────────────

/**
 * Fetch recent posts (used on /latest-tech and /posts pages)
 */
async function fetchRecentPosts(limit = 15) {
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

/**
 * Fetch agents
 */
async function fetchRecentAgents(limit = 15) {
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

/**
 * Fetch prompts
 */
async function fetchRecentPrompts(limit = 15) {
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

/**
 * Fetch AI tools (external tools directory at /ai-tools)
 */
async function fetchRecentAITools(limit = 15) {
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

/**
 * Fetch videos
 */
async function fetchRecentVideos(limit = 15) {
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

// ── Build context-aware system prompt ────────────────────────────────

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

Website pages and their URL patterns:
- Home: /
- Latest Tech News (blog posts): /latest-tech — lists all posts
- Individual post: /posts/{postId}
- AI Agents marketplace: /agents — browse & purchase AI agents
- Individual agent: /agents/{agentId}
- Prompts marketplace: /prompts — browse & purchase prompts
- Individual prompt: /prompts/{promptId}
- AI Tools directory: /ai-tools — curated external AI tools (links open external websites)
- Video Tutorials: /videos — YouTube, TikTok, and Instagram video content
- Monetization Paths: /monetization-paths
- About: /about
- Profile: /profile
- Checkout: /checkout

IMPORTANT LINK RULES:
- When referencing a specific post/article, ALWAYS use the format: /posts/{actual_post_id}
- When referencing a specific agent, ALWAYS use the format: /agents/{actual_agent_id}
- When referencing a specific prompt, use: /prompts/{actual_prompt_id}
- For AI tools on the /ai-tools page: these are EXTERNAL tools. Direct users to /ai-tools to browse them. If you know the tool's external URL, you may share it.
- For videos: direct users to /videos to watch them. If you know the video's original URL, you may share it.
- NEVER guess or fabricate IDs. Only link to content listed in the AVAILABLE CONTENT section below.
- If you don't have a matching item, direct the user to the relevant listing page (e.g., /latest-tech, /agents, /prompts, /ai-tools, /videos) instead of making up a link.

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

/**
 * Build context-aware content section based on the page the user is on.
 */
async function buildContentContext(pageContext) {
  if (!pageContext || !pageContext.page) return '';

  const page = pageContext.page;
  let items = [];
  let section = '';

  switch (page) {
    case 'posts':
    case 'post-detail': {
      items = await fetchRecentPosts();
      if (items.length) {
        section = `\n\nAVAILABLE CONTENT — Recent Posts/Articles (the user is browsing the Latest Tech News page):\n`;
        section += items.map(p =>
          `- "${p.title}" [category: ${p.category}] → Link: /posts/${p.id}`
        ).join('\n');
        section += `\n\nWhen the user asks about an article or post, match their question to one of the posts above and link to it using /posts/{id}. Do NOT link to /agents/ for posts.`;
      }
      break;
    }
    case 'agents':
    case 'agent-detail': {
      items = await fetchRecentAgents();
      if (items.length) {
        section = `\n\nAVAILABLE CONTENT — AI Agents (the user is browsing the Agents marketplace):\n`;
        section += items.map(a =>
          `- "${a.title}" [${a.category}${a.isFree ? ', FREE' : ''}] → Link: /agents/${a.id}`
        ).join('\n');
        section += `\n\nWhen the user asks about an agent, match their question to one of the agents above and link to it using /agents/{id}.`;
      }
      break;
    }
    case 'prompts':
    case 'prompt-detail': {
      items = await fetchRecentPrompts();
      if (items.length) {
        section = `\n\nAVAILABLE CONTENT — Prompts (the user is browsing the Prompts marketplace):\n`;
        section += items.map(p =>
          `- "${p.title}" [${p.category}] → Link: /prompts/${p.id}`
        ).join('\n');
        section += `\n\nWhen the user asks about a prompt, match their question to one of the prompts above and link to it using /prompts/{id}.`;
      }
      break;
    }
    case 'ai-tools': {
      items = await fetchRecentAITools();
      if (items.length) {
        section = `\n\nAVAILABLE CONTENT — AI Tools (the user is browsing the AI Tools directory):\n`;
        section += items.map(a =>
          `- "${a.title}"${a.tags.length ? ` [${a.tags.slice(0, 3).join(', ')}]` : ''}${a.link ? ` → External: ${a.link}` : ''}`
        ).join('\n');
        section += `\n\nThese are external tools. When the user asks about a tool, describe it and share its external link if available. Direct them to /ai-tools to browse the full directory.`;
      }
      break;
    }
    case 'videos': {
      items = await fetchRecentVideos();
      if (items.length) {
        section = `\n\nAVAILABLE CONTENT — Videos (the user is browsing Video Tutorials):\n`;
        section += items.map(v =>
          `- "${v.title}" [${v.platform}${v.authorName ? `, by ${v.authorName}` : ''}]${v.originalUrl ? ` → Watch: ${v.originalUrl}` : ''}`
        ).join('\n');
        section += `\n\nWhen the user asks about a video, match their question to one of the videos above. Share the original URL if available. Direct them to /videos to browse all videos.`;
      }
      break;
    }
    case 'home': {
      // On homepage, give a broad overview - fetch a few from each
      const [posts, agents, prompts] = await Promise.all([
        fetchRecentPosts(5),
        fetchRecentAgents(5),
        fetchRecentPrompts(5),
      ]);
      if (posts.length || agents.length || prompts.length) {
        section = `\n\nAVAILABLE CONTENT — Overview of recent items on the site:\n`;
        if (posts.length) {
          section += `\nRecent posts:\n` + posts.map(p => `- "${p.title}" → /posts/${p.id}`).join('\n');
        }
        if (agents.length) {
          section += `\nRecent agents:\n` + agents.map(a => `- "${a.title}" → /agents/${a.id}`).join('\n');
        }
        if (prompts.length) {
          section += `\nRecent prompts:\n` + prompts.map(p => `- "${p.title}" → /prompts/${p.id}`).join('\n');
        }
        section += `\n\nUse the correct URL pattern for each content type.`;
      }
      break;
    }
    default:
      // For other pages (monetization, about, etc.), no content injection needed
      break;
  }

  // Add page context hint
  if (pageContext.pageTitle) {
    section = `\n\nThe user is currently on the "${pageContext.pageTitle}" page.` + section;
  }

  return section;
}

// ── Helper: build the full system message ────────────────────────────

async function buildSystemMessage(pageContext) {
  const contentContext = await buildContentContext(pageContext);
  return {
    role: 'system',
    content: BASE_SYSTEM_PROMPT + contentContext,
  };
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

// ── Non-streaming endpoint: POST /api/chat ───────────────────────────

exports.processChat = async (req, res) => {
  try {
    const messages = validateRequest(req, res);
    if (!messages) return;

    const { pageContext } = req.body;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const systemMessage = await buildSystemMessage(pageContext);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [systemMessage, ...messages],
      max_tokens: 600,
      temperature: 0.7,
    });

    const assistantMessage = completion.choices[0].message.content;
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
    const systemMessage = await buildSystemMessage(pageContext);

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
    res.flushHeaders();

    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [systemMessage, ...messages],
      max_tokens: 600,
      temperature: 0.7,
      stream: true,
    });

    // Handle client disconnect
    let aborted = false;
    req.on('close', () => { aborted = true; });

    for await (const chunk of stream) {
      if (aborted) break;
      const token = chunk.choices[0]?.delta?.content;
      if (token) {
        res.write(`data: ${JSON.stringify({ token })}\n\n`);
      }
    }

    if (!aborted) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } catch (error) {
    console.error('Chat stream error:', error.message);
    // If headers already sent, try to send error via SSE
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
