# Manual Testing Guide for Agent Reviews & Likes

This document provides instructions for manually testing the agent reviews, ratings, and likes features in the AI Waverider application.

## Prerequisites

1. Start the backend server:
   ```
   cd backend
   npm start
   ```

2. Start the frontend application:
   ```
   cd ..
   npm run dev
   ```

3. Ensure you have a valid user account for testing authenticated features

## Test Cases

### 1. View Agent Details

- Navigate to the agents listing page
- Click on any agent to view its details
- **Expected Result**: The agent detail page should load with the agent's information

### 2. View Existing Reviews

- On an agent detail page, click on the "Reviews" tab
- **Expected Result**: 
  - If the agent has reviews, they should be displayed with the reviewer's name, date, rating, and content
  - If the agent has no reviews, a message should indicate that there are no reviews yet

### 3. Add a Review (Authenticated)

- Login to your account
- Navigate to an agent detail page
- Click on the "Reviews" tab
- Fill out the review form:
  - Set a rating by clicking on the stars
  - Enter some text in the comment field
  - Click "Submit Review"
- **Expected Result**: 
  - Your review should be added to the list
  - A success message should appear
  - The agent's average rating should update

### 4. Add a Review (Unauthenticated)

- Logout of your account
- Navigate to an agent detail page
- Click on the "Reviews" tab
- **Expected Result**: The review form should not be visible, or a message should indicate that you need to login to submit a review

### 5. Like an Agent (Authenticated)

- Login to your account
- Navigate to an agent detail page
- Click the like button (thumbs up)
- **Expected Result**: 
  - The like count should increment
  - The button should change to indicate that you've liked the agent
  - A success message should appear

### 6. Like an Agent (Unauthenticated)

- Logout of your account
- Navigate to an agent detail page
- Click the like button (thumbs up)
- **Expected Result**: A message should indicate that you need to login to like the agent

### 7. Unlike an Agent

- Login to your account
- Navigate to an agent detail page that you've previously liked
- Click the like button again (thumbs up)
- **Expected Result**: 
  - The like count should decrement
  - The button should change to indicate that you've unliked the agent
  - A success message should appear

### 8. View Agent with Rating

- Navigate to an agent that has ratings
- **Expected Result**: 
  - The average rating should be displayed next to the agent's title
  - The correct number of filled and empty stars should be shown based on the rating
  - The number of ratings should be displayed in parentheses

## Backend API Testing (Using curl or Postman)

### Get Agent Reviews

```
GET http://localhost:4000/api/agents/:agentId/reviews
```

Example:
```
curl http://localhost:4000/api/agents/UDCz3kZx5RCTwDXEj7U4/reviews
```

### Add a Review (Requires Auth)

```
POST http://localhost:4000/api/agents/:agentId/reviews
Headers: 
  - Content-Type: application/json
  - Authorization: Bearer YOUR_AUTH_TOKEN
Body: 
  {
    "content": "This is a test review",
    "rating": 5
  }
```

### Toggle Like (Requires Auth)

```
POST http://localhost:4000/api/agents/:agentId/toggle-like
Headers: 
  - Content-Type: application/json
  - Authorization: Bearer YOUR_AUTH_TOKEN
```

### Update Agent Collections

```
POST http://localhost:4000/api/agents/update-collections
```

## Troubleshooting

If you encounter issues with the reviews or likes functionality:

1. **Check Backend Server**: Ensure the backend server is running
2. **Check Console Errors**: Look for errors in the browser console
3. **Authentication Issues**: Verify that you're properly logged in for authenticated endpoints
4. **Database Structure**: Verify that your agents have the proper fields (rating, reviews, likes) by running the update collections endpoint
5. **Network Requests**: Use the browser's network tab to check the API requests and responses

## Expected Database Structure

For reference, here's the expected structure for the agent reviews feature:

**agents collection**:
```
{
  // existing fields...
  rating: {
    average: 0,  // number (0-5)
    count: 0     // number
  },
  reviews: [     // array of review objects
    {
      id: "reviewId",
      userId: "userId",
      userName: "User Name",
      content: "Review text",
      rating: 5,
      createdAt: "2023-01-01T00:00:00.000Z"
    }
  ],
  likes: ["userId1", "userId2", ...] // array of user IDs
}
```

**agent_reviews collection**:
```
{
  id: "reviewId",
  agentId: "agentId",
  userId: "userId",
  userName: "User Name",
  content: "Review text",
  rating: 5,
  createdAt: "2023-01-01T00:00:00.000Z"
}
``` 