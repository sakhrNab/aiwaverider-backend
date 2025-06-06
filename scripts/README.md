# Backend Scripts

This directory contains utility scripts for database management, migrations, and other administrative tasks.

## Available Scripts

### updateAgentsWithDownloadCounts.js

This script updates all agents in the database with their download counts. It fetches the download count from the `agent_stats` collection and adds it directly to each agent document.

**Purpose:**
- Migrate download counts from the separate `agent_stats` collection into the main agent documents
- Eliminate the need for separate API calls to fetch download counts
- Improve performance by reducing the number of database queries

**Usage:**
```bash
node scripts/updateAgentsWithDownloadCounts.js
```

**What it does:**
1. Fetches all agents from the database
2. For each agent, it checks if there is a corresponding entry in the `agent_stats` collection
3. If found, it updates the agent document with the download count
4. If not found, it creates a new stats document with a default download count of 0
5. Provides a summary of the migration results

**Benefits:**
- Frontend no longer needs to make separate API calls to get download counts
- Download counts are available immediately when fetching an agent
- Reduces API traffic and improves performance

## Running Scripts

Most scripts can be run directly with Node:

```bash
node scripts/script-name.js
```

For scripts that require authentication or specific environment variables, make sure to set these up before running the script.

If running on a production database, it's recommended to:
1. Back up the database first
2. Test the script on a development environment
3. Run with caution and monitor the output

# Database Seeding Scripts

This directory contains scripts for seeding the database with mock data for development and testing purposes.

## Firebase Setup

Before running any seeding scripts, make sure your Firebase configuration is correctly set up:

1. Create a Firebase project at https://console.firebase.google.com
2. Generate a private key from Project settings > Service accounts > Generate new private key
3. Save the JSON file in a secure location
4. Update your `.env` file with the path to this file:

```
FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/your-firebase-project-credentials.json
FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
```

## Available Scripts

### Check and Seed All Collections

Checks if all required collections exist in the database and populates them only if needed. This script ensures that all four main sections of the application have data:

- Agents (main collection)
- Featured Agents (marked within the agents collection)
- Top-Rated Agents for recommendations (agents with high ratings)
- Wishlists

This is the recommended script to run when setting up a new environment.

```bash
# From the backend directory:
npm run check:agents
```

### Seed Agents

Seeds the database with mock agent data including images, ratings, reviews, and more. This creates a realistic dataset for the marketplace. This will add data regardless of whether there is existing data.

```bash
# From the backend directory:
npm run seed:agents

# Specify the number of agents to generate (default is 50):
npm run seed:agents 100
```

### Troubleshooting

If you encounter encoding issues with the seeding scripts, try these steps:

1. Ensure your `.env` file is saved with UTF-8 encoding
2. Check that all script files (including `agentsController.js`) are saved with UTF-8 encoding
3. If you're on Windows, make sure PowerShell is set to use UTF-8:
   ```powershell
   [System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8
   ```

### How the Seeding Works

The seeding process:

1. Generates realistic mock data for AI agents with prices, ratings, reviews, etc.
2. Adds user associations, wishlists, and popularity metrics
3. Creates featured and trending agents based on popularity
4. Sets high ratings for some agents to be used in the recommended section
5. Creates wishlists referencing existing agents
6. Uses Firestore batch operations to efficiently write to the database
7. Creates subcollections for reviews and other nested data
8. Handles all necessary relationships between data

### Important Notes

- Running the seed script multiple times may create duplicate data. The script will warn you if it detects existing data.
- The check script will only add data if the corresponding collection is empty.
- The script uses batch operations to ensure efficient database writes and to stay within Firestore's limits.
- You can specify how many agents to generate as a command-line argument.

### For Other Collections

If you need to seed other collections, you can create additional scripts following the same pattern:

1. Create a new script in this directory (e.g., `seedUsers.js`)
2. Add a corresponding script to `package.json` (e.g., `"seed:users": "node scripts/seedUsers.js"`)
3. Follow the same batch processing pattern for efficient database writes

# Firebase Scripts

This directory contains utility scripts for managing Firebase data and configuration.

## Available Scripts

### Create Price Index Script

The `createPriceIndex.js` script has two functions:

1. It adds a `createdAt` field to any price documents that don't have one (using the `updatedAt` value or current timestamp)
2. It provides instructions for creating the required Firestore composite index for the `prices` collection

#### Running the Script

To run the script, navigate to the backend directory and execute:

```bash
node scripts/createPriceIndex.js
```

#### What This Fixes

The script addresses the following error that occurs when retrieving price data:

```
Error: 9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/aiwaverider/firestore/indexes?create_composite=...
```

This error occurs because the price query uses both a filter on `agentId` and a sort by `createdAt`, which requires a composite index in Firestore.

#### Manual Index Creation

If you prefer to create the index manually:

1. Go to the Firebase console: https://console.firebase.google.com/
2. Select your project
3. Navigate to Firestore Database > Indexes > Composite
4. Click "Create Index"
5. Fill in the following details:
   - Collection: `prices`
   - Fields to index:
     - `agentId` (Ascending)
     - `createdAt` (Descending)
6. Click "Create"

Alternatively, you can click the link in the error message to be taken directly to the index creation page.
