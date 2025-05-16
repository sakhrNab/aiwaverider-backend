# AI Wave Rider Backend

This is the backend service for the AI Wave Rider application.

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