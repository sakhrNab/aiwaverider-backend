/**
 * Populate AI Tools with Prompts Script
 * 
 * This script adds sample AI tools with prompt content to your Firestore database.
 * It uses the Firebase Admin SDK to directly write to the collection.
 * 
 * Usage:
 * Run: node scripts/populate-prompt-tools.js
 */

// Import the Firebase configuration from the existing config file
const { admin, db } = require('../config/firebase');
const fs = require('fs');
const path = require('path');

// Check if Firebase is properly initialized
if (!admin || !db) {
  console.error('Firebase Admin SDK or Firestore is not properly initialized');
  process.exit(1);
}

console.log('Firebase Admin SDK and Firestore are properly initialized');

// Collection name for AI tools
const COLLECTION_NAME = 'ai_tools';

// Sample prompt tools data
const promptTools = [
  {
    title: 'AI Image Generation Prompt',
    description: 'A powerful prompt for generating detailed and creative images with AI models.',
    link: 'https://example.com/ai-image-prompt',
    image: '',
    keyword: 'prompt,image,generation',
    tags: ['Image Generation', 'Creative', 'AI Art'],
    category: 'AI Prompts',
    additionalHTML: `
      <h2>How to Use This Prompt</h2>
      <p>Follow these steps to generate amazing images:</p>
      <ol>
        <li>Copy the prompt template below</li>
        <li>Replace the [SUBJECT] with your desired subject</li>
        <li>Adjust other parameters as needed</li>
        <li>Paste into your favorite AI image generator</li>
      </ol>
      
      <h3>Prompt Template</h3>
      <pre style="background-color: #f3f4f6; padding: 1rem; border-radius: 0.5rem; overflow: auto; margin: 1rem 0;">
        [SUBJECT], ultra-detailed, 8k, photorealistic, professional photography, dramatic lighting, vivid colors
      </pre>
      
      <h3>Examples</h3>
      <p>Here are some examples of subjects you can use:</p>
      <ul>
        <li>A majestic eagle soaring over mountains</li>
        <li>A futuristic city with flying cars</li>
        <li>An underwater scene with bioluminescent creatures</li>
      </ul>
      
      <h3>Advanced Parameters</h3>
      <p>For even better results, add these parameters:</p>
      <ul>
        <li><strong>Style:</strong> cinematic, anime, watercolor, oil painting</li>
        <li><strong>Lighting:</strong> golden hour, blue hour, studio, backlit</li>
        <li><strong>Camera:</strong> wide angle, telephoto, macro, drone shot</li>
      </ul>
    `,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  },
  {
    title: 'Coding Assistant Prompt',
    description: 'Optimize your coding workflow with this structured prompt for coding assistants.',
    link: 'https://example.com/coding-prompt',
    image: '',
    keyword: 'prompt,coding,assistant',
    tags: ['Coding', 'Programming', 'Productivity'],
    category: 'Coding Assistant',
    additionalHTML: `
      <h2>The Perfect Coding Assistant Prompt</h2>
      <p>When working with AI coding assistants, structure is key. This prompt template will help you get better results:</p>
      
      <h3>Prompt Structure</h3>
      <div style="padding: 1rem; border: 1px solid #93c5fd; border-radius: 0.5rem; margin: 1rem 0;">
        <p><strong>Task:</strong> [Describe what you want to build]</p>
        <p><strong>Context:</strong> [Provide context about your project]</p>
        <p><strong>Requirements:</strong> [List specific requirements]</p>
        <p><strong>Tech Stack:</strong> [List technologies you're using]</p>
        <p><strong>Constraints:</strong> [Mention any limitations]</p>
      </div>
      
      <h3>Example</h3>
      <div style="padding: 1rem; background-color: #f3f4f6; border-radius: 0.5rem; margin: 1rem 0;">
        <p><strong>Task:</strong> Create a React component for a user profile card</p>
        <p><strong>Context:</strong> Building a social media dashboard</p>
        <p><strong>Requirements:</strong> Display user avatar, name, bio, follower count; Include follow button</p>
        <p><strong>Tech Stack:</strong> React 18, Tailwind CSS</p>
        <p><strong>Constraints:</strong> Must be responsive and accessible</p>
      </div>
      
      <h3>Tips for Better Results</h3>
      <ol>
        <li>Be specific about what you want</li>
        <li>Provide examples when possible</li>
        <li>Specify code style preferences (e.g., functional vs class components)</li>
        <li>Ask for explanations of complex parts</li>
        <li>Request tests if needed</li>
      </ol>
    `,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  },
  {
    title: 'Business Plan Generator Prompt',
    description: 'Generate comprehensive business plans for startups and new ventures with this structured prompt.',
    link: 'https://example.com/business-plan-prompt',
    image: '',
    keyword: 'prompt,business,plan,startup',
    tags: ['Business', 'Startup', 'Planning'],
    category: 'Business',
    additionalHTML: `
      <h2>Business Plan Generator Prompt</h2>
      <p>Use this template to create detailed business plans that cover all essential aspects of your venture:</p>
      
      <h3>Base Prompt Template</h3>
      <div style="padding: 1rem; border: 1px solid #10b981; border-radius: 0.5rem; margin: 1rem 0; background-color: #f0fdf4;">
        <p>I need a comprehensive business plan for a [TYPE OF BUSINESS] in the [INDUSTRY] industry. The business will be called [BUSINESS NAME] and will focus on [PRIMARY VALUE PROPOSITION].</p>
        <p>Target audience: [DESCRIBE YOUR TARGET MARKET]</p>
        <p>Competitive landscape: [MENTION KEY COMPETITORS]</p>
        <p>Initial budget: [APPROXIMATE STARTING CAPITAL]</p>
        <p>Revenue model: [HOW THE BUSINESS WILL MAKE MONEY]</p>
        <p>Please structure the business plan with the following sections:</p>
        <ol>
          <li>Executive Summary</li>
          <li>Company Description</li>
          <li>Market Analysis</li>
          <li>Organization & Management</li>
          <li>Service/Product Line</li>
          <li>Marketing & Sales Strategy</li>
          <li>Financial Projections (3-year outlook)</li>
          <li>Funding Requirements</li>
          <li>Implementation Timeline</li>
          <li>Risk Assessment</li>
        </ol>
      </div>
      
      <h3>Example Filled Template</h3>
      <div style="padding: 1rem; background-color: #f3f4f6; border-radius: 0.5rem; margin: 1rem 0;">
        <p>I need a comprehensive business plan for a <strong>subscription-based meal delivery service</strong> in the <strong>food tech</strong> industry. The business will be called <strong>NutriBox</strong> and will focus on <strong>personalized, nutritionist-designed meals for health-conscious professionals</strong>.</p>
        <p>Target audience: <strong>Urban professionals aged 25-45 with disposable income who are health-conscious but time-poor</strong></p>
        <p>Competitive landscape: <strong>HelloFresh, Blue Apron, but our differentiator is personalization based on nutritional needs</strong></p>
        <p>Initial budget: <strong>$250,000 initial investment</strong></p>
        <p>Revenue model: <strong>Tiered subscription model with add-ons and premium options</strong></p>
        <p>Please structure the business plan with the following sections: [...]</p>
      </div>
    `,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  },
  {
    title: 'Creative Writing Prompt Template',
    description: 'A versatile template for creative writing prompts that can be used with any AI writing assistant.',
    link: 'https://example.com/creative-writing-prompt',
    image: '',
    keyword: 'prompt,writing,creative',
    tags: ['Writing', 'Creative', 'Storytelling'],
    category: 'Creative Writing',
    additionalHTML: `
      <h2>Creative Writing Prompt Generator</h2>
      <p>Use this framework to get high-quality creative writing from AI:</p>
      
      <h3>Basic Structure</h3>
      <div style="padding: 1rem; border: 1px solid #8b5cf6; border-radius: 0.5rem; margin: 1rem 0; background-color: #f5f3ff;">
        <p>Write a [GENRE] story about [MAIN CHARACTER] who [CENTRAL CONFLICT]. The story should be written in [POV] perspective and [TONE]. Include themes of [THEME 1] and [THEME 2].</p>
        <p>The setting is [TIME PERIOD] in [LOCATION]. Start with the following line:</p>
        <p>[OPENING LINE]</p>
        <p>Key elements to include:</p>
        <ul>
          <li>[PLOT ELEMENT 1]</li>
          <li>[PLOT ELEMENT 2]</li>
          <li>[PLOT ELEMENT 3]</li>
        </ul>
        <p>The story should end with [TYPE OF ENDING].</p>
      </div>
      
      <h3>Example</h3>
      <div style="padding: 1rem; background-color: #f3f4f6; border-radius: 0.5rem; margin: 1rem 0;">
        <p>Write a <strong>sci-fi thriller</strong> about <strong>a chronobiologist</strong> who <strong>discovers their research is being used to manipulate time perception in an entire city</strong>. The story should be written in <strong>third-person limited</strong> perspective and <strong>have a tense, paranoid tone</strong>. Include themes of <strong>corporate surveillance</strong> and <strong>the ethics of scientific discovery</strong>.</p>
        <p>The setting is <strong>2055</strong> in <strong>Neo-Shanghai</strong>. Start with the following line:</p>
        <p><em>"Dr. Lin checked her watch for the third time in as many minutes, but something about the way time moved felt wrong."</em></p>
        <p>Key elements to include:</p>
        <ul>
          <li>A mysterious corporation called "Chronos Industries"</li>
          <li>Strange side effects appearing in the city population</li>
          <li>An unexpected ally from within the corporation</li>
        </ul>
        <p>The story should end with <strong>a moral dilemma that leaves the outcome ambiguous</strong>.</p>
      </div>
      
      <h3>Tips for Better Results</h3>
      <ul>
        <li>Be specific about genre conventions you want to see</li>
        <li>Provide character details like age, personality traits, or background</li>
        <li>Define the stakes clearly</li>
        <li>For longer stories, outline key plot points</li>
      </ul>
    `,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  },
  {
    title: 'Marketing Copy Generator Prompt',
    description: 'Create compelling marketing copy for any product or service with this structured prompt.',
    link: 'https://example.com/marketing-prompt',
    image: '',
    keyword: 'prompt,marketing,copywriting',
    tags: ['Marketing', 'Copywriting', 'Advertising'],
    category: 'Marketing',
    additionalHTML: `
      <h2>Marketing Copy Generator</h2>
      <p>Use this framework to create persuasive marketing copy for any purpose:</p>
      
      <h3>The Formula</h3>
      <div style="padding: 1rem; border: 1px solid #ef4444; border-radius: 0.5rem; margin: 1rem 0; background-color: #fef2f2;">
        <p>Write [TYPE OF CONTENT] for [PRODUCT/SERVICE] targeting [TARGET AUDIENCE]. The copy should focus on [PRIMARY BENEFIT] and address the customer's pain point of [PAIN POINT].</p>
        <p>The tone should be [TONE] and incorporate [BRAND VOICE CHARACTERISTICS]. Use the following structure:</p>
        <ol>
          <li>Attention-grabbing headline that highlights [KEY SELLING POINT]</li>
          <li>Opening that addresses the reader's problem</li>
          <li>Introduction of the product/service as the solution</li>
          <li>2-3 key benefits with supporting details</li>
          <li>Social proof element (testimonial or statistic)</li>
          <li>Clear call-to-action that encourages [DESIRED ACTION]</li>
        </ol>
        <p>Word count: Approximately [WORD COUNT]</p>
      </div>
      
      <h3>Example</h3>
      <div style="padding: 1rem; background-color: #f3f4f6; border-radius: 0.5rem; margin: 1rem 0;">
        <p>Write <strong>website landing page copy</strong> for <strong>EcoSleep, an organic bamboo mattress</strong> targeting <strong>environmentally-conscious millennials with disposable income</strong>. The copy should focus on <strong>sustainability without compromising comfort</strong> and address the customer's pain point of <strong>wanting eco-friendly products that actually perform well</strong>.</p>
        <p>The tone should be <strong>informative yet warm</strong> and incorporate <strong>light humor and environmental consciousness</strong>. Use the following structure:</p>
        <ol>
          <li>Attention-grabbing headline that highlights <strong>the dual benefit of luxury comfort and environmental responsibility</strong></li>
          <li>Opening that addresses the reader's problem</li>
          <li>Introduction of the product as the solution</li>
          <li>2-3 key benefits with supporting details</li>
          <li>Social proof element (testimonial or statistic)</li>
          <li>Clear call-to-action that encourages <strong>visiting a showroom or ordering online with the 100-night trial</strong></li>
        </ol>
        <p>Word count: Approximately <strong>300-350 words</strong></p>
      </div>
    `,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }
];

/**
 * Add a prompt tool to Firestore
 */
async function addPromptTool(toolData) {
  try {
    const docRef = await db.collection(COLLECTION_NAME).add(toolData);
    console.log(`Added prompt tool with ID: ${docRef.id}`);
    return docRef.id;
  } catch (error) {
    console.error(`Error adding prompt tool: ${error.message}`);
    return null;
  }
}

/**
 * Main function to populate the database
 */
async function populatePromptTools() {
  console.log('Starting to populate prompt tools...');
  
  const addedIds = [];
  
  for (const tool of promptTools) {
    const id = await addPromptTool(tool);
    if (id) addedIds.push(id);
  }
  
  console.log(`Successfully added ${addedIds.length} prompt tools to the database.`);
  console.log('Added tool IDs:', addedIds);
  
  return addedIds;
}

// Run the populate function
populatePromptTools()
  .then(() => {
    console.log('Population completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Error during population:', error);
    process.exit(1);
  });
