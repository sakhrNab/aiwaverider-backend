/**
 * Swagger Configuration for AIWaverider Backend API
 * 
 * This file contains the Swagger/OpenAPI configuration and documentation
 * for all API endpoints in the AIWaverider platform.
 */

const swaggerJsdoc = require('swagger-jsdoc');

// Swagger definition
const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'AIWaverider Backend API',
    version: '1.0.0',
    description: 'Comprehensive API documentation for the AIWaverider platform - AI agents marketplace with payment processing, user management, and content delivery.',
    contact: {
      name: 'AIWaverider Support',
      email: 'support@aiwaverider.com',
      url: 'https://aiwaverider.com'
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT'
    }
  },
  servers: [
    {
      url: process.env.NODE_ENV === 'production' 
        ? 'https://api.aiwaverider.com' 
        : 'http://localhost:4000',
      description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server'
    }
  ],
  components: {
    securitySchemes: {
      FirebaseAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Firebase Authentication Token'
      },
      AdminToken: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Admin-Token',
        description: 'Admin authentication token'
      },
    TestAuth: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Test authentication token (Development only) - Use "test-admin-token" or "test-user-token"'
    },
    AdminApiKey: {
      type: 'apiKey',
      in: 'header',
      name: 'X-Admin-API-Key',
      description: 'Admin API key for production token generation'
    }
    },
    schemas: {
      // Common Response Schemas
      SuccessResponse: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true
          },
          message: {
            type: 'string',
            example: 'Operation completed successfully'
          },
          data: {
            type: 'object',
            description: 'Response data'
          }
        }
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: false
          },
          error: {
            type: 'string',
            example: 'Error message'
          },
          details: {
            type: 'string',
            example: 'Additional error details'
          }
        }
      },
      PaginationResponse: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true
          },
          data: {
            type: 'array',
            items: {
              type: 'object'
            }
          },
          pagination: {
            type: 'object',
            properties: {
              page: {
                type: 'integer',
                example: 1
              },
              limit: {
                type: 'integer',
                example: 10
              },
              total: {
                type: 'integer',
                example: 100
              },
              totalPages: {
                type: 'integer',
                example: 10
              }
            }
          }
        }
      },
      
      // Agent Schemas
      Agent: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: 'agent-123'
          },
          title: {
            type: 'string',
            example: 'AI Writing Assistant'
          },
          description: {
            type: 'string',
            example: 'Advanced AI agent for content creation and writing assistance'
          },
          category: {
            type: 'string',
            example: 'Writing'
          },
          price: {
            type: 'object',
            properties: {
              basePrice: {
                type: 'number',
                example: 9.99
              },
              currency: {
                type: 'string',
                example: 'USD'
              }
            }
          },
          imageUrl: {
            type: 'string',
            example: 'https://example.com/agent-image.jpg'
          },
          iconUrl: {
            type: 'string',
            example: 'https://example.com/agent-icon.png'
          },
          jsonFileUrl: {
            type: 'string',
            example: 'https://example.com/agent-config.json'
          },
          tags: {
            type: 'array',
            items: {
              type: 'string'
            },
            example: ['writing', 'content', 'ai']
          },
          downloadCount: {
            type: 'integer',
            example: 150
          },
          likes: {
            type: 'array',
            items: {
              type: 'string'
            },
            example: ['user1', 'user2']
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-15T10:30:00Z'
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-15T10:30:00Z'
          }
        }
      },
      
      // User Schemas
      User: {
        type: 'object',
        properties: {
          uid: {
            type: 'string',
            example: 'firebase-user-id-123'
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'user@example.com'
          },
          username: {
            type: 'string',
            example: 'johndoe'
          },
          firstName: {
            type: 'string',
            example: 'John'
          },
          lastName: {
            type: 'string',
            example: 'Doe'
          },
          displayName: {
            type: 'string',
            example: 'John Doe'
          },
          photoURL: {
            type: 'string',
            example: 'https://example.com/profile.jpg'
          },
          role: {
            type: 'string',
            enum: ['user', 'admin'],
            example: 'user'
          },
          isAdmin: {
            type: 'boolean',
            example: false
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-15T10:30:00Z'
          }
        }
      },
      
      // Payment Schemas
      PaymentSession: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: 'session_123'
          },
          amount: {
            type: 'number',
            example: 9.99
          },
          currency: {
            type: 'string',
            example: 'USD'
          },
          status: {
            type: 'string',
            enum: ['pending', 'completed', 'failed', 'cancelled'],
            example: 'pending'
          },
          paymentMethod: {
            type: 'string',
            example: 'paypal'
          },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                agentId: {
                  type: 'string',
                  example: 'agent-123'
                },
                title: {
                  type: 'string',
                  example: 'AI Writing Assistant'
                },
                price: {
                  type: 'number',
                  example: 9.99
                }
              }
            }
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-15T10:30:00Z'
          }
        }
      },
      
      // AI Tool Schemas
      AITool: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: 'tool-123'
          },
          title: {
            type: 'string',
            example: 'Code Generator'
          },
          description: {
            type: 'string',
            example: 'AI-powered code generation tool'
          },
          link: {
            type: 'string',
            example: 'https://example.com/tool'
          },
          image: {
            type: 'string',
            example: 'https://example.com/tool-image.jpg'
          },
          keywords: {
            type: 'array',
            items: {
              type: 'string'
            },
            example: ['code', 'generation', 'ai']
          },
          tags: {
            type: 'array',
            items: {
              type: 'string'
            },
            example: ['development', 'coding']
          },
          category: {
            type: 'string',
            example: 'Development'
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-15T10:30:00Z'
          }
        }
      },
      
      // Video Schemas
      Video: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: 'video-123'
          },
          platform: {
            type: 'string',
            enum: ['youtube', 'vimeo', 'tiktok'],
            example: 'youtube'
          },
          originalUrl: {
            type: 'string',
            example: 'https://youtube.com/watch?v=123'
          },
          title: {
            type: 'string',
            example: 'AI Agent Tutorial'
          },
          description: {
            type: 'string',
            example: 'Learn how to use AI agents effectively'
          },
          thumbnailUrl: {
            type: 'string',
            example: 'https://example.com/thumbnail.jpg'
          },
          viewCount: {
            type: 'integer',
            example: 1000
          },
          likeCount: {
            type: 'integer',
            example: 50
          },
          duration: {
            type: 'string',
            example: '5:30'
          },
          addedBy: {
            type: 'string',
            example: 'admin-user-id'
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-15T10:30:00Z'
          }
        }
      },
      Prompt: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: 'prompt-123'
          },
          title: {
            type: 'string',
            example: 'AI Writing Assistant Prompt'
          },
          description: {
            type: 'string',
            example: 'A comprehensive prompt for AI writing assistance'
          },
          content: {
            type: 'string',
            example: 'You are a professional writing assistant...'
          },
          category: {
            type: 'string',
            example: 'AI Prompts'
          },
          tags: {
            type: 'array',
            items: {
              type: 'string'
            },
            example: ['writing', 'productivity', 'AI']
          },
          keywords: {
            type: 'array',
            items: {
              type: 'string'
            },
            example: ['writing', 'content', 'assistant']
          },
          featured: {
            type: 'boolean',
            example: false
          },
          imageUrl: {
            type: 'string',
            example: 'https://example.com/image.jpg'
          },
          link: {
            type: 'string',
            example: 'https://example.com/prompt'
          },
          likes: {
            type: 'integer',
            example: 42
          },
          views: {
            type: 'integer',
            example: 150
          },
          createdBy: {
            type: 'string',
            example: 'user-123'
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-15T10:30:00Z'
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-15T10:30:00Z'
          }
        }
      },
      AITool: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: 'tool-123'
          },
          title: {
            type: 'string',
            example: 'Code Generator'
          },
          description: {
            type: 'string',
            example: 'An AI-powered code generation tool'
          },
          link: {
            type: 'string',
            example: 'https://example.com/tool'
          },
          image: {
            type: 'string',
            example: 'https://example.com/image.jpg'
          },
          keywords: {
            type: 'array',
            items: {
              type: 'string'
            },
            example: ['coding', 'development', 'ai']
          },
          tags: {
            type: 'array',
            items: {
              type: 'string'
            },
            example: ['ai', 'coding', 'productivity']
          },
          category: {
            type: 'string',
            example: 'Development'
          },
          additionalHTML: {
            type: 'string',
            example: '<div>Additional content</div>'
          },
          createdBy: {
            type: 'string',
            example: 'user-123'
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-15T10:30:00Z'
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-15T10:30:00Z'
          }
        }
      }
    }
  },
  tags: [
    {
      name: 'Authentication',
      description: 'User authentication and session management'
    },
    {
      name: 'Agents',
      description: 'AI agents marketplace - browse, search, and manage agents'
    },
    {
      name: 'Payments',
      description: 'Payment processing and order management'
    },
    {
      name: 'Users',
      description: 'User profile and account management'
    },
    {
      name: 'AI Tools',
      description: 'AI tools and utilities management'
    },
    {
      name: 'Videos',
      description: 'Video content management'
    },
    {
      name: 'Admin',
      description: 'Administrative functions and system management'
    },
    {
      name: 'Chat',
      description: 'AI chat and conversation endpoints'
    },
    {
      name: 'Health',
      description: 'System health and monitoring'
    },
    {
      name: 'Prompts',
      description: 'AI prompts management and discovery'
    },
    {
      name: 'Recommendations',
      description: 'Personalized recommendations system'
    },
    {
      name: 'PayPal Integration',
      description: 'PayPal payment processing endpoints'
    },
    {
      name: 'UniPay Integration',
      description: 'UniPay payment processing endpoints'
    },
        {
          name: 'Cache Management',
          description: 'Cache management and refresh endpoints'
        },
    {
      name: 'Test Authentication',
      description: 'Test authentication endpoints for development and automation'
    },
    {
      name: 'Admin Token Service',
      description: 'Secure admin token generation for production use'
    }
  ]
};

// Options for swagger-jsdoc
const options = {
  definition: swaggerDefinition,
  apis: [
    './routes/**/*.js',
    './controllers/**/*.js',
    './index.js'
  ]
};

// Generate swagger specification
const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
