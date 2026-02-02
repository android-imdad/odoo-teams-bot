# Claude Code Context

## Project

Odoo Teams Bot - A production-ready Microsoft Teams bot that uses AI to parse natural language timesheet entries and automatically log them to Odoo.

## Tech Stack

- **Language**: TypeScript (Node.js v20+)
- **Bot Framework**: Microsoft BotBuilder SDK
- **Server**: Restify
- **AI**: Google Gemini (generative-ai)
- **ERP Integration**: Odoo XML-RPC (xmlrpc)
- **Task Matching**: Fuse.js (fuzzy search for task filtering)
- **Logging**: Winston with file rotation
- **UI**: Adaptive Cards
- **Testing**: Jest + ts-jest
- **CI/CD**: GitHub Actions

## Architecture

```
src/
├── index.ts                      # Entry point, starts Restify server on port 3978
├── bot.ts                        # Main bot activity handler
├── config/
│   ├── config.ts                 # Environment config via dotenv
│   ├── configValidation.ts       # Schema-based configuration validation
│   └── logger.ts                 # Winston logger with file rotation
├── services/
│   ├── odoo.ts                   # Odoo XML-RPC client (timesheet CRUD)
│   ├── parser.ts                 # Gemini AI for natural language parsing
│   ├── cache.ts                  # In-memory project cache (TTL: 1hr)
│   ├── responseCache.ts          # AI response caching for cost optimization
│   ├── taskFilter.ts             # Fuse.js fuzzy search for task filtering
│   ├── audit.ts                  # Audit trail logging for compliance
│   ├── health.ts                 # Health checks and monitoring endpoints
│   └── resilience.ts             # Graceful degradation and offline queuing
├── cards/
│   └── timesheetCard.ts          # Adaptive Card templates
├── middleware/
│   ├── errorHandler.ts           # Error handling utilities
│   ├── errorRecovery.ts          # Comprehensive error classification & recovery
│   └── rateLimit.ts              # Rate limiting middleware
├── types/                        # TypeScript definitions
└── utils/
    ├── validation.ts             # Input validation
    ├── formatting.ts             # Date/time formatting
    ├── sanitization.ts           # Input sanitization (XSS, SQL injection prevention)
    └── retry.ts                  # Retry mechanism with exponential backoff
```

## Production-Ready Features

### Security
- **Input Sanitization** (`utils/sanitization.ts`): XSS prevention, SQL injection protection
- **Rate Limiting** (`middleware/rateLimit.ts`): Per-user and per-endpoint limits
- **Configuration Validation** (`config/configValidation.ts`): Schema-based validation at startup
- **Audit Trail** (`services/audit.ts`): Complete logging of all user actions

### Resilience
- **Retry Mechanism** (`utils/retry.ts`): Exponential backoff for transient failures
- **Graceful Degradation** (`services/resilience.ts`): Offline queuing when Odoo is unavailable
- **Error Recovery** (`middleware/errorRecovery.ts`): Automatic error classification and recovery
- **Health Monitoring** (`services/health.ts`): `/health` and `/metrics` endpoints

### Performance
- **Task Filtering** (`services/taskFilter.ts`): Fuse.js fuzzy search to filter tasks before AI parsing - reduces token usage from 10,000 tasks to top 5 matches
- **Response Caching** (`services/responseCache.ts`): Cache AI responses to reduce API costs
- **Project Caching** (`services/cache.ts`): In-memory cache with TTL

### Quality
- **Test Suite** (`test/`): Jest tests with coverage reporting
- **CI/CD Pipeline** (`.github/workflows/ci.yml`): Automated testing and deployment

## Environment Variables

Required in `.env`:
```bash
# Bot Configuration
BOT_ID=your-bot-id
BOT_PASSWORD=your-bot-password
PORT=3978

# Odoo Configuration
ODOO_URL=https://your-odoo-instance.com
ODOO_DB=your-database-name
ODOO_USERNAME=your-username
ODOO_PASSWORD=your-password

# Gemini AI Configuration
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3-flash-preview

# Cache Configuration
PROJECT_CACHE_TTL=3600000  # 1 hour in milliseconds

# Logging Configuration
LOG_LEVEL=info
LOG_FILE=logs/bot.log

# Environment
NODE_ENV=production
```

## Commands

```bash
# Development
npm run dev              # Development with ts-node
npm run watch            # Watch mode for TypeScript compilation

# Build & Run
npm run build            # Compile TypeScript
npm start                # Production (runs dist/index.js)

# Testing
npm test                 # Run Jest tests
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Generate coverage report

# Quality
npm run lint             # Run ESLint
npm run lint:fix         # Fix linting issues
npm run validate         # Validate configuration
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check status |
| `/metrics` | GET | Prometheus metrics |
| `/api/messages` | POST | Bot messaging endpoint |

## Key Patterns

- All operations are async/await
- Projects are cached to reduce Odoo API calls
- Winston logs to `logs/` with rotation
- Adaptive Cards for interactive Teams responses
- All user inputs are sanitized before processing
- External API calls have retry logic with exponential backoff
- Errors are classified and automatically recovered when possible
- Audit trail tracks all user actions for compliance

## Monitoring & Observability

### Health Check
```bash
curl http://localhost:3978/health
```

Returns:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600000,
  "checks": [...],
  "metrics": {...}
}
```

### Prometheus Metrics
```bash
curl http://localhost:3978/metrics
```

Returns metrics in Prometheus format for scraping.

## Testing

Run tests with coverage:
```bash
npm run test:coverage
```

Run specific test file:
```bash
npm test -- sanitization.test.ts
```

## Deployment

The CI/CD pipeline automatically:
1. Lints code
2. Runs tests
3. Builds TypeScript
4. Runs security scans
5. Builds Docker image
6. Deploys to production on merge to main

## Error Handling

The bot uses a comprehensive error handling system:
- **Network Errors**: Automatic retry with exponential backoff
- **Rate Limits**: Queued for later processing
- **Service Unavailable**: Graceful degradation with offline queue
- **Validation Errors**: User-friendly error messages
- **Authentication Errors**: Logged for admin review

## Task Filtering

The bot uses **Fuse.js** to intelligently filter tasks before sending them to the AI parser:

### How It Works
1. User sends message: "4 hours on Website project Homepage Redesign"
2. Bot fetches all tasks for the identified project (could be 10,000+)
3. **Fuse.js filters** tasks using fuzzy matching against the user's query
4. Only the **top 5 most relevant tasks** are sent to Gemini AI
5. AI parses with a focused task list (~100 tokens instead of ~200,000)

### Benefits
- **Cost Reduction**: Reduces AI token usage by 99%+ when projects have many tasks
- **Performance**: Fuse.js runs locally with no additional API calls
- **Accuracy**: Fuzzy matching handles typos, partial matches, and word variations
- **Scalability**: Works efficiently regardless of project size

### Configuration
```typescript
// Default settings in taskFilter.ts
{
  limit: 5,           // Return top 5 matches
  threshold: 0.6,     // Fuzzy match tolerance (0-1)
  keys: ['name']      // Search in task name field
}
```
