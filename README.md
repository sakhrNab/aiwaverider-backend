# AI Wave Rider Backend

This is the backend service for the AI Wave Rider application - an AI agents marketplace with payment processing, user management, and content delivery.

## 🚀 Quick Start

1. **Install dependencies**: `npm install`
2. **Set up environment**: Copy `.env.example` to `.env` and configure
3. **Start the server**: `npm start`
4. **View API docs**: Visit `http://localhost:4000/api-docs`

## 📚 API Documentation

### Swagger/OpenAPI Documentation

The backend includes comprehensive API documentation powered by Swagger/OpenAPI 3.0:

- **Interactive UI**: `http://localhost:4000/api-docs`
- **Raw JSON**: `http://localhost:4000/api-docs.json`
- **Health Check**: `http://localhost:4000/_health`

### Current API Coverage

- **Total Endpoints**: ~170
- **Documented**: ~50+ (30% coverage)
- **Authentication**: Complete
- **User Management**: Complete
- **Profile Management**: Complete
- **Agents Management**: Partial
- **Payment Integration**: Partial

### Documented Endpoints

#### Authentication (`/api/auth/`)
- User registration and login
- Session management
- Token verification and refresh
- User signout

#### User Management (`/api/users/`)
- Get all users with pagination
- Get user by ID
- Create, update, and delete users
- User role management

#### Profile Management (`/api/profile/`)
- Get and update user profiles
- Avatar upload
- Interest management
- Notification preferences
- Favorites management
- Settings configuration
- Community information

#### Agents (`/api/agents/`)
- List all agents with filtering
- Featured and latest agents
- Agent search and pagination
- Individual agent details

#### Other Services
- AI Tools management
- Video content management
- Chat processing
- Payment system testing
- Admin settings

### API Features

- **Authentication**: Firebase Auth integration
- **Pagination**: Consistent pagination across all list endpoints
- **Filtering**: Advanced filtering and search capabilities
- **Caching**: Redis-based caching for improved performance
- **Rate Limiting**: Built-in rate limiting for API protection
- **Error Handling**: Comprehensive error responses with proper HTTP status codes
- **Validation**: Request validation with detailed error messages

### Swagger Implementation Details

The Swagger documentation is implemented using:

- **swagger-jsdoc**: Generates OpenAPI specs from JSDoc comments
- **swagger-ui-express**: Serves the interactive documentation UI
- **OpenAPI 3.0**: Latest specification standard
- **JSDoc Comments**: Documentation embedded directly in route files

#### Configuration Files

- `config/swagger.js`: Main Swagger configuration
- Route files: Individual endpoint documentation
- `index.js`: Swagger UI setup and serving

#### Adding New Endpoints

To add Swagger documentation for new endpoints:

1. Add JSDoc comments above the route handler
2. Include `@swagger` tag
3. Define request/response schemas
4. Specify security requirements
5. Add parameter descriptions

Example:
```javascript
/**
 * @swagger
 * /api/example:
 *   get:
 *     summary: Example endpoint
 *     description: This is an example endpoint
 *     tags: [Example]
 *     responses:
 *       200:
 *         description: Success response
 */
router.get('/example', exampleController);
```

## Docker Setup

### Prerequisites

- Docker installed on your machine
- Docker Compose installed on your machine

### Environment Variables

Before running the application, you need to set up your environment variables:

1. Create a `.env` file in the backend directory
2. Copy the variables from the `.env.example` file and fill in your values

### Building and Running with Docker

#### Build the Docker image

```bash
# From the root directory
docker build -t ai-wave-rider-backend ./backend
```

#### Run the container

```bash
# From the root directory
docker run -p 4000:8080 --env-file ./backend/.env ai-wave-rider-backend
```

### Using Docker Compose

To run the application with Docker Compose:

```bash
# From the root directory
docker-compose up -d
```

This will start:
- The backend service on port 4000
- Redis on port 6379 (with persistent data volume)

To stop the containers:

```bash
docker-compose down
```

### Development with Docker

For development, you can mount your local code into the container:

```bash
docker run -p 4000:8080 \
  -v ./backend:/app \
  -v /app/node_modules \
  --env-file ./backend/.env \
  ai-wave-rider-backend
```

### Container Environment Variables

The following environment variables can be passed to the container:

- `NODE_ENV`: Set to 'production' or 'development'
- `PORT`: The port the app will run on inside the container
- `RUN_MIGRATIONS`: Set to 'true' to run migrations on startup
- `SEED_DATA`: Set to 'true' to seed data on startup
- `REDIS_HOST`: Redis hostname (default: 'redis' when using docker-compose)
- `REDIS_PORT`: Redis port (default: 6379)

## Running Without Docker

To run the application without Docker:

1. Ensure Node.js and npm are installed
2. Install dependencies: `npm install`
3. Start the server: `npm start`

For development mode with hot reloading:

```bash
npm run dev
```

### Running Redis Locally

If not using Docker, you'll need to install and run Redis locally:

1. Install Redis following the [official instructions](https://redis.io/docs/getting-started/)
2. Start the Redis server: `redis-server`
3. Configure the application to connect to your local Redis instance in your `.env` file 