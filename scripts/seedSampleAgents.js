/**
 * Script to seed sample agents in the Firebase database
 * Run with: node scripts/seedSampleAgents.js
 */

const { db, admin } = require('../config/firebase');

// Sample agent data
const sampleAgents = [
  {
    id: 'chatgpt-prompts',
    title: 'ChatGPT Prompts to Increase Productivity',
    description: 'A collection of prompts to help you get the most out of ChatGPT for various tasks.',
    price: 0,
    isFree: true,
    imageUrl: 'https://picsum.photos/300/200?random=1',
    categories: ['Software Development', 'Business', 'Self Improvement'],
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
    creator: {
      id: 'creator-1',
      name: 'AI Enthusiast'
    },
    rating: {
      average: 4.7,
      count: 128
    },
    popularity: 95
  },
  {
    id: 'resume-template',
    title: 'Professional Resume Template',
    description: 'Stand out with this clean, professional resume template designed for job seekers in tech.',
    price: 9.99,
    isFree: false,
    imageUrl: 'https://picsum.photos/300/200?random=2',
    categories: ['Business', 'Design'],
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
    creator: {
      id: 'creator-2',
      name: 'Career Coach'
    },
    rating: {
      average: 4.9,
      count: 87
    },
    popularity: 92
  },
  {
    id: 'ai-art-generator',
    title: 'AI Art Generator Prompt Pack',
    description: 'Create stunning digital art with these optimized prompts for various AI art generators.',
    price: 14.99,
    isFree: false,
    imageUrl: 'https://picsum.photos/300/200?random=3',
    categories: ['Design', 'Drawing & Painting', 'AI'],
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
    creator: {
      id: 'creator-3',
      name: 'Digital Artist'
    },
    rating: {
      average: 4.5,
      count: 62
    },
    popularity: 88
  }
];

async function seedAgents() {
  try {
    console.log('Starting to seed sample agents...');
    
    // Add each agent to the database
    for (const agent of sampleAgents) {
      const agentRef = db.collection('agents').doc(agent.id);
      
      // Check if the agent already exists
      const doc = await agentRef.get();
      if (doc.exists) {
        console.log(`Agent ${agent.id} already exists, updating it...`);
        await agentRef.update({
          ...agent,
          updatedAt: admin.firestore.Timestamp.now()
        });
      } else {
        console.log(`Creating new agent: ${agent.id}`);
        await agentRef.set(agent);
      }
    }
    
    console.log('Successfully seeded sample agents!');
    return true;
  } catch (error) {
    console.error('Error seeding agents:', error);
    return false;
  }
}

seedAgents()
  .then(success => {
    if (success) {
      console.log('Sample agents have been added to the database.');
      console.log('These agents have fixed IDs that match the emergency fallback in recommendations.js');
    } else {
      console.error('Failed to seed sample agents.');
    }
    process.exit(0);
  })
  .catch(err => {
    console.error('Unexpected error:', err);
    process.exit(1);
  }); 