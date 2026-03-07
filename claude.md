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
│   ├── resilience.ts             # Graceful degradation and offline queuing
│   └── userMapping.ts            # Teams email to Odoo user mapping (admin proxy mode)
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

# Authentication Mode: service_account | api_key | oauth | admin_proxy
AUTH_MODE=admin_proxy

# For admin_proxy mode (recommended for enterprise):
# Uses admin account to log timesheets on behalf of users matched by email
ODOO_USERNAME=admin@yourcompany.com
ODOO_PASSWORD=your-admin-password

# For api_key mode (users generate their own API keys):
# ODOO_USERNAME and ODOO_PASSWORD not required

# For oauth mode:
OAUTH_ENABLED=true
ODOO_OAUTH_CLIENT_ID=your-client-id
ODOO_OAUTH_CLIENT_SECRET=your-client-secret
ODOO_OAUTH_REDIRECT_URI=https://your-bot-url/auth/oauth/callback
TOKEN_ENCRYPTION_KEY=YOUR_API_KEY_HERE

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

## Authentication Modes

The bot supports four authentication modes, configurable via `AUTH_MODE`:

### 1. Admin Proxy Mode (`AUTH_MODE=admin_proxy`) - RECOMMENDED

**Best for:** Enterprise environments where IT manages Odoo access centrally.

**How it works:**
- The bot uses a single admin service account to authenticate with Odoo
- When a user sends a timesheet entry, the bot extracts their email from Teams
- The bot looks up the user's Odoo account by matching the email in `res.users`
- Timesheets are logged using the admin account but attributed to the matched user

**Setup:**
1. Create an admin service account in Odoo with rights to create timesheets for all users
2. Set `AUTH_MODE=admin_proxy`
3. Configure `ODOO_USERNAME` and `ODOO_PASSWORD` with the admin credentials
4. Ensure users' Teams emails match their Odoo login emails

**Benefits:**
- Users don't need to authenticate or manage API keys
- Zero-friction onboarding - users can start logging immediately
- IT maintains centralized control

### 2. API Key Mode (`AUTH_MODE=api_key`)

**Best for:** Teams where users can manage their own API keys.

**How it works:**
- Each user generates an API Key in their Odoo profile
- Users connect their account by providing the API Key to the bot
- The bot stores encrypted API keys and uses them for per-user authentication

**Setup:**
- Set `AUTH_MODE=api_key`
- Users run "connect" command and enter their API Key

### 3. OAuth Mode (`AUTH_MODE=oauth`)

**Best for:** Self-hosted Odoo with OAuth provider configured.

**How it works:**
- Users authenticate via OAuth flow
- The bot receives and stores access/refresh tokens
- Tokens are used for per-user API calls

**Setup:**
- Set `AUTH_MODE=oauth` and `OAUTH_ENABLED=true`
- Configure OAuth provider in Odoo
- Set up OAuth application credentials

### 4. Service Account Mode (`AUTH_MODE=service_account`)

**Best for:** Single-user testing only.

**⚠️ WARNING:** Not for production. All users share the same Odoo account.

## API Endpoints

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

## User Email Mapping (Admin Proxy Mode)

When using `AUTH_MODE=admin_proxy`, the bot automatically maps Teams users to Odoo users via email:

### How It Works

1. **Extract Email:** The bot extracts the user's email from the Teams context using multiple methods:
   - `activity.from.name` (if it contains an email)
   - Teams channel data
   - `TeamsInfo.getMember()` API (most reliable)

2. **Look Up User:** The admin service account searches Odoo's `res.users` model:
   ```python
   # Odoo search domain
   [('login', '=ilike', user_email), ('active', '=', true)]
   ```

3. **Log Timesheet:** Creates the timesheet entry with the matched user's ID:
   ```python
   {
     'project_id': project_id,
     'task_id': task_id,
     'user_id': matched_user_id,  # The user found by email
     'unit_amount': hours,
     'date': date,
     'name': description
   }
   ```

### Email Matching Requirements

For successful matching, ensure:
- The user's Teams email matches their Odoo login email (case-insensitive)
- The Odoo user account is active
- The admin service account has read access to `res.users`

### Caching

User lookups are cached for 1 hour to reduce Odoo API calls. Failed lookups are cached for 5 minutes to avoid repeated searches for non-existent users.

### Troubleshooting

If a user gets "No Odoo user found" error:
1. Verify their Teams email matches their Odoo login
2. Check the user is active in Odoo
3. Use the `status` command to see what email the bot detects
4. Check logs for the actual email being looked up

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
