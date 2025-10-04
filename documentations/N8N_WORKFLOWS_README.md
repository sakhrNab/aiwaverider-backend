# N8N Workflows Processing

This directory contains scripts to process N8N workflow files and populate them into the Firebase agents collection.

## Overview

The process converts N8N workflow files (`.txt` files that are actually JSON) into business-focused agent listings for the AI Waverider marketplace.

## Scripts

### 1. `rename-txt-to-json.js`
- Renames all `.txt` files to `.json` in the N8N workflows directory
- Includes dry-run mode for safety
- Recursively processes all subdirectories

### 2. `n8n-workflow-processor.js`
- Main processor that analyzes N8N workflows
- Extracts integrations and functionality
- Generates business-focused content using OpenAI
- Uploads files to Firebase Storage
- Creates agent documents in Firebase

### 3. `test-n8n-workflow.js`
- Tests the processing with a single workflow
- Shows analysis results without creating agents
- Useful for debugging and validation

### 4. `run-n8n-setup.js`
- Complete setup process
- Runs file renaming and single workflow test
- Entry point for the entire process

## Usage

### Quick Start
```bash
# Run the complete setup process
node run-n8n-setup.js
```

### Step by Step
```bash
# 1. Rename files (dry run first)
node rename-txt-to-json.js

# 2. Test with single workflow
node test-n8n-workflow.js

# 3. Process all workflows (when ready)
node n8n-workflow-processor.js
```

## Configuration

Edit the `CONFIG` object in `n8n-workflow-processor.js`:

```javascript
const CONFIG = {
  N8N_WORKFLOWS_PATH: 'E:\\N8N\\n8n-master-workflows',
  COLLECTION_NAME: 'agents',
  TEST_MODE: true, // Set to false for full processing
  OPENAI_MODEL: 'gpt-4o-mini',
  MAX_COST_LIMIT: 10, // $10 limit for testing
  DELAY_BETWEEN_CALLS: 1000
};
```

## Features

- **File Renaming**: Converts `.txt` files to `.json` (they're actually JSON with wrong extension)
- **Integration Extraction**: Analyzes workflow nodes to identify integrations
- **AI Content Generation**: Uses OpenAI to create business-focused descriptions
- **Firebase Integration**: Uploads files and creates agent documents
- **Category Support**: Adds "New" category for all processed agents
- **Cost Tracking**: Monitors OpenAI API usage and costs

## Generated Agent Data

Each processed workflow becomes an agent with:

- **Title**: Business-focused name based on workflow purpose
- **Description**: Marketplace-ready description with deliverables
- **Features**: 4 business-focused features
- **Categories**: Includes "New" plus relevant business categories
- **Business Value**: Quantified benefits statement
- **Integrations**: Extracted from workflow nodes
- **Deliverables**: Workflow file + setup guide (README.txt)
- **Pricing**: 50% free, 50% paid ($10-50 based on complexity)
  - Low complexity (≤10 nodes): $10-20
  - Medium complexity (11-20 nodes): $20-30
  - High complexity (>20 nodes): $30-50
- **Images**: Empty (frontend generates SVG placeholders)
- **Metadata**: Node count, complexity, file info, workflow ID
- **Currency**: USD
- **Status**: All marked as "New" category

## Safety Features

- **Dry Run Mode**: Test file renaming without actual changes
- **Test Mode**: Process only 1 agent for validation
- **Cost Limits**: Stop processing if API costs exceed limit
- **Error Handling**: Graceful failure with detailed logging
- **Validation**: Checks for required fields and data integrity

## Requirements

- Node.js with Firebase Admin SDK
- OpenAI API key
- Google Cloud Storage access
- N8N workflows directory with `.txt` files

## Next Steps

1. Run `node run-n8n-setup.js` to test the process
2. Review the generated agent data
3. If satisfied, set `TEST_MODE = false` and run the full processor
4. Monitor the Firebase agents collection for new entries
5. Check the frontend to see agents in the "New" category
