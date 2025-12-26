const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin SDK using the existing configuration
require('../config/firebase.js');

const db = admin.firestore();
const COLLECTION_NAME = 'prompts';

/**
 * Script to populate prompts collection with 20 detailed prompts
 * 
 * This script creates 20 diverse prompts with rich HTML content
 * designed for the TipTap editor format.
 * 
 * Usage: node scripts/populate-prompts.js
 */

// Detailed prompts data exactly as provided
const promptsData = [
  {
    title: "Professional Corporate Headshot Creator",
    description: "Generate stunning professional headshots perfect for LinkedIn profiles, corporate websites, and business cards.",
    category: "AI Art Generator",
    keywords: ["professional headshot", "corporate photo", "business portrait", "linkedin photo"],
    tags: ["Professional", "Business", "Portrait", "Corporate"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Professional Corporate Headshot</h2>
  <div class="prompt-content">
    <p class="prompt-description">Create a professional headshot with these specifications:</p>
    <div class="prompt-text">
      Professional corporate headshot of a [AGE] [GENDER] with [HAIR_COLOR] hair, wearing a [CLOTHING_TYPE] in [COLOR]. Clean, well-lit studio background in [BACKGROUND_COLOR]. Subject looking directly at camera with a confident, approachable smile. Shot with professional lighting, sharp focus on eyes. Corporate style, high resolution, suitable for LinkedIn profile or business website. Neutral expression conveying competence and trustworthiness.
    </div>
    <div class="usage-tips">
      <h3>Usage Tips:</h3>
      <ul>
        <li>Replace bracketed placeholders with specific details</li>
        <li>Choose neutral colors for professional appearance</li>
        <li>Ensure good lighting for clear facial features</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: true,
    link: "",
    image: ""
  },
  {
    title: "Modern Minimalist Logo Designer",
    description: "Create sleek, modern logos with clean lines and professional aesthetics for any business or brand.",
    category: "Creative Writing",
    keywords: ["logo design", "branding", "minimalist design", "business logo"],
    tags: ["Design", "Branding", "Logo", "Minimalist"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Modern Minimalist Logo Design</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Design a modern, minimalist logo for [COMPANY_NAME], a [INDUSTRY] company. The logo should feature clean geometric shapes, use [PRIMARY_COLOR] and [SECONDARY_COLOR] as the color palette. Include subtle gradients and ensure the design works well in both light and dark backgrounds. Style should be contemporary, scalable, and memorable. Vector-based design with smooth curves and sharp edges where appropriate. Professional typography if text is included.
    </div>
    <div class="design-specs">
      <h3>Design Specifications:</h3>
      <ul>
        <li>Scalable vector format</li>
        <li>Works in monochrome</li>
        <li>Clean, readable typography</li>
        <li>Memorable and unique</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: true,
    link: "",
    image: ""
  },
  {
    title: "Viral Social Media Post Generator",
    description: "Create engaging, shareable content designed to boost engagement and reach across all social platforms.",
    category: "Marketing",
    keywords: ["social media", "viral content", "engagement", "marketing"],
    tags: ["Social Media", "Marketing", "Viral", "Content"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Viral Social Media Content</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Create a vibrant, eye-catching social media post about [TOPIC]. Use bold, contrasting colors with [PRIMARY_COLOR] as the dominant hue. Include engaging typography with a catchy headline, relevant emojis, and call-to-action text. Modern gradient backgrounds, trendy design elements. Optimized for [PLATFORM] dimensions. Style should be contemporary, energetic, and scroll-stopping. Include space for brand logo placement.
    </div>
    <div class="platform-specs">
      <h3>Platform Specifications:</h3>
      <ul>
        <li>Instagram: 1080x1080px square</li>
        <li>Facebook: 1200x630px landscape</li>
        <li>Twitter: 1024x512px landscape</li>
        <li>TikTok: 1080x1920px vertical</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "Stunning Website Hero Section Creator",
    description: "Design compelling hero sections that capture attention and drive conversions for modern websites.",
    category: "AI Art Generator",
    keywords: ["hero section", "web design", "landing page", "conversion"],
    tags: ["Web Design", "Hero", "Landing Page", "UX"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Website Hero Section Design</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Design a modern website hero section for [BUSINESS_TYPE]. Include a compelling headline, subheading, and prominent call-to-action button. Use [COLOR_SCHEME] color palette with subtle gradients. Add geometric shapes or abstract elements as background decoration. Professional imagery placeholder on one side, text content on the other. Clean, modern typography. Responsive layout that works on desktop and mobile. Include subtle shadows and depth effects.
    </div>
    <div class="design-elements">
      <h3>Key Elements:</h3>
      <ul>
        <li>Compelling headline and subheading</li>
        <li>Prominent CTA button</li>
        <li>Background imagery or graphics</li>
        <li>Responsive layout structure</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "E-commerce Product Photography",
    description: "Create professional product photos perfect for online stores, catalogs, and marketing materials.",
    category: "AI Art Generator",
    keywords: ["product photography", "ecommerce", "studio lighting", "commercial"],
    tags: ["Photography", "E-commerce", "Product", "Commercial"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Professional Product Photography</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Professional product photography of [PRODUCT] on a clean white background. Studio lighting with soft shadows, shot from [ANGLE]. Product should be centered and well-lit with no harsh shadows. Include subtle reflections on the surface below. High resolution, sharp focus throughout. Commercial photography style suitable for e-commerce listings. Professional color grading with accurate color reproduction.
    </div>
    <div class="lighting-tips">
      <h3>Lighting Setup:</h3>
      <ul>
        <li>Soft, even lighting from multiple angles</li>
        <li>Minimal shadows for clean look</li>
        <li>Highlight product features and textures</li>
        <li>Consistent white balance</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "Complete Brand Identity System",
    description: "Develop comprehensive brand identities including logos, color palettes, typography, and style guides.",
    category: "Creative Writing",
    keywords: ["brand identity", "style guide", "brand system", "corporate identity"],
    tags: ["Branding", "Identity", "Style Guide", "Corporate"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Complete Brand Identity System</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Create a comprehensive brand identity for [BRAND_NAME] in the [INDUSTRY] sector. Include primary logo, secondary marks, color palette with hex codes, typography hierarchy, and style guide elements. Modern, professional aesthetic that conveys [BRAND_PERSONALITY]. Color scheme should include [PRIMARY_COLORS] with supporting neutral tones. Ensure versatility across digital and print applications.
    </div>
    <div class="brand-elements">
      <h3>Brand Package Includes:</h3>
      <ul>
        <li>Primary and secondary logos</li>
        <li>Color palette with hex codes</li>
        <li>Typography selection</li>
        <li>Usage guidelines and examples</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: true,
    link: "",
    image: ""
  },
  {
    title: "High-Converting Email Template Designer",
    description: "Design email templates that drive opens, clicks, and conversions for marketing campaigns.",
    category: "Marketing",
    keywords: ["email marketing", "newsletter", "email template", "conversion"],
    tags: ["Email", "Marketing", "Template", "Conversion"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Email Marketing Template</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Design a professional email marketing template for [CAMPAIGN_TYPE]. Include header with logo placement, compelling subject line area, main content sections with clear hierarchy, and prominent call-to-action buttons. Use [BRAND_COLORS] color scheme. Mobile-responsive layout with clean typography. Include social media icons in footer and unsubscribe area. Modern design with good whitespace and visual balance.
    </div>
    <div class="email-specs">
      <h3>Email Best Practices:</h3>
      <ul>
        <li>600px max width for compatibility</li>
        <li>Clear visual hierarchy</li>
        <li>Prominent CTA buttons</li>
        <li>Mobile-responsive design</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "Modern Architecture Renderer",
    description: "Create stunning architectural visualizations and renderings for buildings, interiors, and spaces.",
    category: "AI Art Generator",
    keywords: ["architecture", "3d rendering", "visualization", "building design"],
    tags: ["Architecture", "3D", "Rendering", "Visualization"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Architectural Visualization</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Create a photorealistic architectural rendering of a [BUILDING_TYPE] with [ARCHITECTURAL_STYLE] design. Include detailed exterior materials like [MATERIALS], large windows, and modern landscaping. Set during [TIME_OF_DAY] with appropriate lighting conditions. Add environmental elements like trees, sky, and surrounding context. Professional architectural visualization quality with accurate proportions and realistic materials and textures.
    </div>
    <div class="rendering-specs">
      <h3>Rendering Details:</h3>
      <ul>
        <li>Photorealistic materials and textures</li>
        <li>Accurate lighting and shadows</li>
        <li>Environmental context and landscaping</li>
        <li>Professional presentation quality</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "Data Visualization Infographic Creator",
    description: "Transform complex data into engaging, easy-to-understand visual infographics.",
    category: "Content Creation",
    keywords: ["infographic", "data visualization", "information design", "charts"],
    tags: ["Infographic", "Data", "Visualization", "Charts"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Data Visualization Infographic</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Create an engaging infographic about [TOPIC] using [COLOR_SCHEME] color palette. Include charts, graphs, icons, and statistical representations. Modern, clean design with clear visual hierarchy. Use bold headers, supporting text, and data callouts. Include relevant icons and illustrations to support the data. Vertical layout optimized for social media sharing. Professional typography with good contrast and readability.
    </div>
    <div class="infographic-elements">
      <h3>Essential Elements:</h3>
      <ul>
        <li>Clear data visualization</li>
        <li>Consistent color scheme</li>
        <li>Engaging icons and graphics</li>
        <li>Logical information flow</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "Fantasy Character Creator",
    description: "Design unique fantasy characters for games, stories, and creative projects.",
    category: "AI Art Generator",
    keywords: ["character design", "fantasy", "concept art", "character creation"],
    tags: ["Character", "Fantasy", "Concept Art", "Design"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Fantasy Character Design</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Design a [CHARACTER_TYPE] character for a fantasy setting. Character should be [AGE_RANGE] with [DISTINCTIVE_FEATURES]. Wearing [CLOTHING_STYLE] appropriate for [ROLE/CLASS]. Include detailed accessories, weapons, or tools relevant to their profession. Art style should be [ART_STYLE] with rich colors and intricate details. Full body pose showing personality and attitude. Background can be simple or environmental context.
    </div>
    <div class="character-specs">
      <h3>Character Elements:</h3>
      <ul>
        <li>Distinctive visual features</li>
        <li>Appropriate clothing and accessories</li>
        <li>Personality reflected in pose</li>
        <li>Consistent art style throughout</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "Mobile App UI/UX Designer",
    description: "Create beautiful, intuitive mobile app interfaces that enhance user experience.",
    category: "AI Art Generator",
    keywords: ["mobile app", "UI design", "UX design", "app interface"],
    tags: ["Mobile", "UI", "UX", "App Design"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Mobile App Interface Design</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Design a mobile app interface for [APP_TYPE] with [DESIGN_STYLE] aesthetic. Include navigation elements, content areas, and interactive buttons. Use [COLOR_SCHEME] with good contrast for accessibility. Modern typography, intuitive icon design, and clear visual hierarchy. Screen should show [SPECIFIC_SCREEN] with relevant functionality. Include status bar, navigation, and proper spacing following mobile design guidelines.
    </div>
    <div class="mobile-specs">
      <h3>Mobile Design Guidelines:</h3>
      <ul>
        <li>Touch-friendly button sizes (44px minimum)</li>
        <li>Clear visual hierarchy</li>
        <li>Consistent navigation patterns</li>
        <li>Accessibility considerations</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "Gourmet Food Photography",
    description: "Create mouth-watering food photography perfect for restaurants, menus, and social media.",
    category: "AI Art Generator",
    keywords: ["food photography", "culinary", "restaurant", "menu photography"],
    tags: ["Food", "Photography", "Culinary", "Restaurant"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Gourmet Food Photography</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Professional food photography of [DISH_NAME] plated elegantly on [PLATE_TYPE]. Shot from [ANGLE] with natural lighting that highlights textures and colors. Include complementary garnishes and styling elements. Background should be [BACKGROUND_STYLE] to make the food pop. Use shallow depth of field to focus on the main dish. Colors should be vibrant and appetizing, suitable for restaurant menus or social media marketing.
    </div>
    <div class="food-styling">
      <h3>Food Styling Tips:</h3>
      <ul>
        <li>Fresh, vibrant ingredients</li>
        <li>Elegant plating and presentation</li>
        <li>Natural lighting for authentic colors</li>
        <li>Props that complement, don't distract</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "Professional Presentation Designer",
    description: "Create compelling business presentations that engage audiences and drive results.",
    category: "Business Plan",
    keywords: ["presentation", "business slides", "pitch deck", "corporate presentation"],
    tags: ["Presentation", "Business", "Slides", "Corporate"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Business Presentation Template</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Design a professional presentation slide for [PRESENTATION_TYPE]. Include clear headline, supporting content area, and visual elements. Use [COMPANY_COLORS] brand colors with professional typography. Layout should accommodate charts, graphs, or images as needed. Clean, modern design with plenty of whitespace. Consistent with corporate branding guidelines. Include subtle design elements that enhance without distracting from content.
    </div>
    <div class="slide-elements">
      <h3>Slide Components:</h3>
      <ul>
        <li>Clear, compelling headline</li>
        <li>Structured content areas</li>
        <li>Brand-consistent colors and fonts</li>
        <li>Space for charts and visuals</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "Fashion Portrait Photographer",
    description: "Create stunning fashion photography with style, elegance, and contemporary flair.",
    category: "AI Art Generator",
    keywords: ["fashion photography", "portrait", "style", "fashion model"],
    tags: ["Fashion", "Photography", "Portrait", "Style"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Fashion Photography Session</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Fashion photography featuring a model wearing [CLOTHING_DESCRIPTION] in [SETTING/LOCATION]. Professional lighting with [LIGHTING_STYLE] to create mood and depth. Model should have [POSE_DESCRIPTION] with confident expression. Use [COLOR_PALETTE] color grading. Background should be [BACKGROUND_TYPE]. High fashion editorial style with sharp focus on clothing details and textures. Contemporary fashion photography aesthetic.
    </div>
    <div class="fashion-specs">
      <h3>Fashion Photography Elements:</h3>
      <ul>
        <li>Professional model posing</li>
        <li>High-end clothing and styling</li>
        <li>Editorial-quality lighting</li>
        <li>Contemporary fashion aesthetic</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "Podcast Artwork Creator",
    description: "Design eye-catching podcast covers that stand out in podcast directories and attract listeners.",
    category: "Content Creation",
    keywords: ["podcast cover", "audio branding", "podcast artwork", "media design"],
    tags: ["Podcast", "Audio", "Branding", "Cover Art"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Podcast Cover Artwork</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Design a podcast cover for "[PODCAST_NAME]" about [PODCAST_TOPIC]. Use [COLOR_SCHEME] with bold, readable typography that works at small sizes. Include relevant imagery or icons related to the podcast theme. Modern design that stands out in podcast directories. Square format (3000x3000px recommended). Ensure podcast title is clearly legible at thumbnail size. Professional, contemporary style that appeals to [TARGET_AUDIENCE].
    </div>
    <div class="podcast-specs">
      <h3>Podcast Cover Requirements:</h3>
      <ul>
        <li>Square format (1:1 aspect ratio)</li>
        <li>High resolution (3000x3000px)</li>
        <li>Readable at small sizes</li>
        <li>Eye-catching and memorable</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "Event Marketing Poster Creator",
    description: "Create compelling event posters that drive attendance and generate excitement.",
    category: "Marketing",
    keywords: ["event poster", "event marketing", "promotional design", "event advertising"],
    tags: ["Event", "Marketing", "Poster", "Advertising"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Event Marketing Poster</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Design an eye-catching poster for [EVENT_NAME] happening on [DATE] at [VENUE]. Use [THEME_COLORS] that match the event theme. Include event title, date, time, location, and key details. Add visual elements related to [EVENT_TYPE]. Typography should be bold and attention-grabbing. Include space for sponsor logos if needed. Design should work for both print and digital distribution. Create excitement and urgency to attend.
    </div>
    <div class="poster-elements">
      <h3>Essential Information:</h3>
      <ul>
        <li>Event name and theme</li>
        <li>Date, time, and location</li>
        <li>Key speakers or attractions</li>
        <li>Contact or registration info</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "Interior Space Designer",
    description: "Create beautiful interior design concepts for homes, offices, and commercial spaces.",
    category: "AI Art Generator",
    keywords: ["interior design", "room design", "home decor", "space planning"],
    tags: ["Interior", "Design", "Home", "Decor"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Interior Design Visualization</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Create an interior design concept for a [ROOM_TYPE] in [DESIGN_STYLE] style. Include furniture arrangement, color scheme using [COLOR_PALETTE], lighting fixtures, and decorative elements. Room should feel [MOOD/ATMOSPHERE] with proper proportion and scale. Include textures like [MATERIALS] and ensure good flow and functionality. Natural lighting through windows, modern fixtures, and contemporary furnishings. Photorealistic rendering quality.
    </div>
    <div class="design-considerations">
      <h3>Design Elements:</h3>
      <ul>
        <li>Functional furniture layout</li>
        <li>Cohesive color scheme</li>
        <li>Appropriate lighting design</li>
        <li>Texture and material variety</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "Click-Worthy YouTube Thumbnail Designer",
    description: "Design YouTube thumbnails that increase click-through rates and video views.",
    category: "Content Creation",
    keywords: ["youtube thumbnail", "video marketing", "thumbnail design", "youtube seo"],
    tags: ["YouTube", "Thumbnail", "Video", "Marketing"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">YouTube Thumbnail Design</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Create a compelling YouTube thumbnail for a video about [VIDEO_TOPIC]. Use bright, contrasting colors with [PRIMARY_COLOR] as the dominant hue. Include large, bold text that's readable on mobile devices. Add an expressive face or relevant imagery that conveys [EMOTION/REACTION]. Use arrows, circles, or other elements to guide attention. 1280x720 pixels, designed to stand out in search results and suggested videos.
    </div>
    <div class="thumbnail-tips">
      <h3>Thumbnail Best Practices:</h3>
      <ul>
        <li>High contrast colors</li>
        <li>Large, readable text</li>
        <li>Expressive faces or reactions</li>
        <li>Clear visual hierarchy</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "Professional Book Cover Creator",
    description: "Design captivating book covers that attract readers and represent the story within.",
    category: "Creative Writing",
    keywords: ["book cover", "book design", "publishing", "cover art"],
    tags: ["Book", "Cover", "Publishing", "Literature"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Book Cover Design</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Design a book cover for "[BOOK_TITLE]" by [AUTHOR_NAME] in the [GENRE] genre. Use imagery and colors that reflect the [BOOK_THEME/MOOD]. Include the title prominently with author name. Typography should match the genre conventions while being unique and memorable. Consider the target audience of [TARGET_READERS]. Include space for back cover text and spine design. Professional publishing quality suitable for print and digital formats.
    </div>
    <div class="cover-specs">
      <h3>Book Cover Elements:</h3>
      <ul>
        <li>Eye-catching front cover design</li>
        <li>Clear title and author name</li>
        <li>Genre-appropriate imagery</li>
        <li>Professional typography</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  },
  {
    title: "Fitness Tracking App Designer",
    description: "Create motivational fitness app interfaces that encourage healthy habits and track progress.",
    category: "Productivity",
    keywords: ["fitness app", "health tracking", "workout interface", "fitness ui"],
    tags: ["Fitness", "Health", "App", "Tracking"],
    additionalHTML: `<div class="prompt-container">
  <h2 class="prompt-title">Fitness App Interface</h2>
  <div class="prompt-content">
    <div class="prompt-text">
      Design a mobile fitness app interface showing [SCREEN_TYPE] with motivational design elements. Use energetic colors like [COLOR_SCHEME] to inspire action. Include progress indicators, workout data, and achievement elements. Modern, clean interface with intuitive navigation. Add fitness-related icons and graphics. Typography should be clear and motivational. Include charts or graphs to visualize fitness progress and goals.
    </div>
    <div class="fitness-features">
      <h3>App Features to Include:</h3>
      <ul>
        <li>Progress tracking visualizations</li>
        <li>Motivational design elements</li>
        <li>Clear data presentation</li>
        <li>Intuitive user interface</li>
      </ul>
    </div>
  </div>
</div>`,
    isFeatured: false,
    link: "",
    image: ""
  }
];

/**
 * Add a prompt to Firestore
 * @param {Object} promptData - The prompt data to add
 * @returns {Promise<string>} - The document ID of the created prompt
 */
async function addPrompt(promptData) {
  try {
    // Add timestamp fields
    const promptWithTimestamps = {
      ...promptData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdBy: 'admin', // Since this is a script
      
      // Prompt-specific fields
      likes: [], // Array of user IDs who liked this prompt
      likeCount: 0,
      viewCount: 0,
      downloadCount: 0,
      isPublic: true,
      type: 'prompt' // Explicitly mark as prompt
    };
    
    const docRef = await db.collection(COLLECTION_NAME).add(promptWithTimestamps);
    console.log(`✅ Added prompt: ${promptData.title} (ID: ${docRef.id})`);
    return docRef.id;
  } catch (error) {
    console.error(`❌ Error adding prompt ${promptData.title}:`, error);
    throw error;
  }
}

/**
 * Populate all prompts
 */
async function populatePrompts() {
  try {
    console.log('🚀 Starting prompts population...');
    console.log(`📊 Found ${promptsData.length} prompts to add`);
    
    const addedIds = [];
    
    for (const prompt of promptsData) {
      try {
        const id = await addPrompt(prompt);
        addedIds.push(id);
      } catch (error) {
        console.error(`❌ Failed to add prompt: ${prompt.title}`, error);
      }
    }
    
    console.log(`\n✅ Successfully added ${addedIds.length} prompts to the database.`);
    console.log('📋 Added prompt IDs:', addedIds);
    
    return addedIds;
  } catch (error) {
    console.error('❌ Error in populatePrompts:', error);
    throw error;
  }
}

/**
 * Verify the prompts were added correctly
 */
async function verifyPrompts() {
  try {
    console.log('\n🔍 Verifying prompts in database...');
    
    const snapshot = await db.collection(COLLECTION_NAME).get();
    
    if (snapshot.empty) {
      console.log('❌ No prompts found in collection');
      return;
    }
    
    console.log(`📊 Found ${snapshot.size} prompts in database:`);
    
    snapshot.forEach(doc => {
      const data = doc.data();
      console.log(`   - ${data.title} (${doc.id})`);
      console.log(`     Category: ${data.category}`);
      console.log(`     Featured: ${data.isFeatured}`);
      console.log(`     Keywords: ${data.keywords?.length || 0}`);
      console.log(`     Tags: ${data.tags?.length || 0}`);
    });
    
  } catch (error) {
    console.error('❌ Error verifying prompts:', error);
  }
}

/**
 * Main execution
 */
const main = async () => {
  try {
    console.log('🚀 Starting Prompts Population Script');
    console.log('=====================================\n');
    
    // Populate prompts
    await populatePrompts();
    
    // Verify the results
    await verifyPrompts();
    
    console.log('\n✅ Script completed successfully!');
    
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    // Close the Firebase connection
    process.exit(0);
  }
};

// Run the script
if (require.main === module) {
  main();
}

module.exports = { populatePrompts, addPrompt, verifyPrompts }; 