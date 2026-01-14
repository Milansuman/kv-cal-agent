# kv-cal-agent

An AI-powered calendar agent built with LangGraph, Groq, and PostgreSQL for intelligent event management and conflict detection.

## Prerequisites

- Node.js (v18 or higher)
- Docker and Docker Compose
- A Groq API key

## Setup Instructions

### 1. Clone the Repository

```bash
git clone git@github.com:Milansuman/kv-cal-agent.git
cd kv-cal-agent
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Configuration

Create a `.env` file in the root directory with the following variables:

```env
GROQ_API_KEY=your_groq_api_key_here
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kvcal
```

Replace `your_groq_api_key_here` with your actual Groq API key.

### 4. Start the Database

Start the PostgreSQL database using Docker Compose:

```bash
npm run db:up
```

Or directly:

```bash
docker compose up
```

The database will be available at `localhost:5432`.

### 5. Push Database Schema

Apply the database schema using Drizzle:

```bash
npm run db:push
```

### 6. Run the Agent

Start the development server:

```bash
npm run dev
```

The agent will now be running and ready to manage your calendar events!

## Project Structure

- `src/agent.ts` - Main agent implementation with LangGraph
- `src/tools.ts` - Calendar management tools
- `src/conflict.ts` - Conflict detection logic
- `src/db/schema.ts` - Database schema definitions
- `src/db/index.ts` - Database connection setup
- `drizzle.config.ts` - Drizzle ORM configuration
- `docker-compose.yml` - PostgreSQL database setup

## Available Scripts

- `npm run dev` - Run the agent in development mode
- `npm run db:up` - Start the PostgreSQL database
- `npm run db:push` - Push database schema changes
