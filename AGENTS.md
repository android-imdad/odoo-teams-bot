# AI Agent Context for Odoo Teams Bot

> This document provides context for AI agents working on this codebase. It includes architecture overview, key patterns, integration details, and development workflows.

## Executive Summary

**Odoo Teams Bot** is a production-ready Microsoft Teams bot that uses AI (Google Gemini) to parse natural language timesheet entries and log them to Odoo ERP. 

- **Language**: TypeScript (Node.js v20+)
- **Main Framework**: Microsoft BotBuilder SDK v4
- **Server**: Restify
- **AI**: Google Gemini (generative-ai)
- **ERP Integration**: Odoo XML-RPC
- **Task Matching**: Fuse.js fuzzy search
- **Testing**: Jest + ts-jest

## System Architecture

```
┌─────────────────────┐
│ Microsoft Teams     │
│ (User Interface)    │
└──────────┬──────────┘
           │ Bot Framework v4
           ▼
┌─────────────────────┐      ┌──────────────────┐      ┌────────────────┐
│ Restify Server      │      │ Gemini AI        │      │ Odoo ERP       │
│ (Port 3978)         │─────▶│ (Parser Service) │      │ (XML-RPC)      │
│                     │      └──────────────────┘      └────────────────┘
│  ┌───────────────┐  │
│  │ TimesheetBot │  │      ┌──────────────────┐
│  │ (Activity     │  │      │ Caching Layer   │
│  │  Handler)     │  │      │ - Projects       │
│  └───────────────┘  │      │ - Responses     │
│                     │      │ - User Lookups  │
│  ┌───────────────┐  │      └──────────────────┘
│  │ Middleware    │  │
│  │ - Rate Limit  │  │      ┌──────────────────┐
│  │ - Error Rec.  │  │      │ Audit Trail     │
│  │ - Validation  │  │      │ (JSONL Log)     │
│  └───────────────┘  │      └──────────────────┘
└─────────────────────┘
```

## Directory Structure

```
src/
├── index.ts                      # Entry point, Restify server setup
├── bot.ts                        # Main bot activity handler (TimesheetBot)
├── config/
│   ├── config.ts                 # Environment configuration via dotenv
│   ├── configValidation.ts       # Schema-based config validation (Joi-like)
│   └── logger.ts                 # Winston logger with file rotation
├── services/
│   ├── odoo.ts                   # Odoo XML-RPC client (timesheet CRUD)
│   ├── parser.ts                 # Gemini AI natural language parser
│   ├── cache.ts                  # In-memory project cache (TTL: 1hr)
│   ├── responseCache.ts          # AI response caching for cost optimization
│   ├── taskFilter.ts             # Fuse.js fuzzy search for task filtering
│   ├── audit.ts                  # Audit trail logging for compliance
│   ├── health.ts                 # Health checks and Prometheus metrics
│   ├── resilience.ts             # Graceful degradation, offline queue
│   ├── userMapping.ts            # Teams email → Odoo user ID mapping
│   ├── oauth.ts                  # OAuth 2.0 authentication flow
│   ├── apiKeyAuth.ts             # API Key authentication
│   ├── tokenStorage.ts           # Encrypted SQLite token storage
│   └── tokenRefresh.ts           # Background token refresh job
├── cards/
│   └── timesheetCard.ts          # Adaptive Card templates
├── middleware/
│   ├── errorHandler.ts           # Error handling utilities
│   ├── errorRecovery.ts          # Error classification & recovery strategies
│   └── rateLimit.ts              # Per-user rate limiting
├── types/
│   ├── index.ts                  # Core type definitions (TimesheetEntry, etc.)
│   └── oauth.types.ts            # OAuth-specific types
├── utils/
│   ├── validation.ts             # Input validation helpers
│   ├── formatting.ts             # Date/time formatting
│   ├── sanitization.ts           # XSS/SQL injection prevention
│   └── retry.ts                  # Exponential backoff retry
├── routes/
│   └── healthRoutes.ts           # Health & metrics endpoints
└── test/                         # Jest tests mirroring src/ structure

data/                              # Runtime data directory
├── tokens.db                      # SQLite token storage
├── tokens.db-journal             # SQLite journal
└── offline-queue.json            # Offline timesheet queue

logs/                              # Winston log files
└── bot.log                        # Rotating log file
```

## Authentication Modes

**CRITICAL**: The bot supports 4 authentication modes. The mode determines how users are authenticated with Odoo.

### 1. Admin Proxy Mode (`AUTH_MODE=admin_proxy`) - RECOMMENDED for Enterprise

**Best for**: Enterprise with centralized IT management.

**How it works**:
1. Bot uses admin service account credentials
2. When user sends timesheet, bot extracts their Teams email
3. Admin account looks up user in `res.users` by email (case-insensitive)
4. Timesheet created with admin auth but `user_id` set to matched user
5. User lookups cached (successful: 1hr, failed: 5min)

**Code Path**:
```typescript
// src/services/userMapping.ts
export class UserMappingService {
  async getUserByEmail(email: string): Promise<number | null> {
    // Check cache first
    // Query Odoo: res.users with login = email
    // Cache result and return user_id
  }
}

// src/services/odoo.ts
async logTime(entry: TimesheetEntry): Promise<number> {
  // If admin_proxy mode:
  // 1. Authenticate with admin credentials
  // 2. Look up user by email
  // 3. Create timesheet with user_id from lookup
}
```

### 2. API Key Mode (`AUTH_MODE=api_key`)

**Best for**: Teams where users manage their own Odoo API keys.

**How it works**:
1. User sends "connect" command
2. Bot displays Adaptive Card for API key input
3. User enters Odoo API Key + Username
4. Bot stores encrypted key in SQLite (`data/tokens.db`)
5. Timesheet calls use stored API key via XML-RPC

**Code Path**:
```typescript
// src/services/apiKeyAuth.ts
export class ApiKeyAuthService {
  async validateApiKey(apiKey: string, username: string): Promise<number>
  async getApiKeyForUser(userId: string): Promise<string | null>
}

// src/services/tokenStorage.ts
export class TokenStorage {
  async storeApiKey(userId: string, apiKey: string, username: string): Promise<void>
  async getApiKey(userId: string): Promise<{ apiKey: string; username: string } | null>
}
```

### 3. OAuth Mode (`AUTH_MODE=oauth`)

**Best for**: Self-hosted Odoo with OAuth provider.

**How it works**:
1. User sends "connect oauth" command
2. Bot generates OAuth authorization URL with PKCE
3. User authenticates in browser → callback to `/auth/oauth/callback`
4. Tokens stored encrypted in SQLite
5. Background job refreshes tokens before expiry

**Code Path**:
```typescript
// src/services/oauth.ts
export class OAuthService {
  generateAuthUrl(state: string): string
  async exchangeCodeForTokens(code: string): Promise<OAuthTokens>
  async refreshAccessToken(refreshToken: string): Promise<OAuthTokens>
}

// src/routes/healthRoutes.ts (added OAuth callback route)
server.get('/auth/oauth/callback', async (req, res) => {
  // Exchange code for tokens
  // Store tokens
  // Notify user
});
```

### 4. Service Account Mode (`AUTH_MODE=service_account`)

**NOT FOR PRODUCTION** - All users share single account.

## Core Services

### OdooService (`src/services/odoo.ts`)

**Purpose**: XML-RPC client for Odoo ERP integration.

**Key Methods**:
```typescript
class OdooService {
  // Authentication
  async authenticate(): Promise<number>
  async getAuthForUser(userId: string): Promise<AuthContext>
  
  // Project & Task operations
  async getProjects(): Promise<OdooProject[]>
  async getTasks(projectId: number): Promise<OdooTask[]>
  async getProjectById(projectId: number): Promise<OdooProject | null>
  
  // Timesheet operations
  async logTime(entry: TimesheetEntry): Promise<number>
  async createTimeEntry(data: {...}): Promise<number>
  
  // User operations (admin_proxy mode)
  async getUserByEmail(email: string): Promise<OdooUser | null>
}
```

**Models Used**:
- `project.project` - Projects
- `project.task` - Tasks
- `account.analytic.line` - Timesheet entries
- `res.users` - Users (for email lookup in admin_proxy mode)

**Caching**:
- Projects cached for configurable TTL (default: 1hr)
- User lookups cached (successful: 1hr, failed: 5min)

### ParserService (`src/services/parser.ts`)

**Purpose**: Parse natural language to structured timesheet data.

**AI Model**: Google Gemini (configurable via `GEMINI_MODEL`)

**Prompt Engineering**:
```typescript
const prompt = `
You are a timesheet parsing assistant. Parse the following natural language timesheet entry.

Available projects:
${projects.map(p => `- ${p.name} (ID: ${p.id})`).join('\n')}

Available tasks for project "${projectName}":
${tasks.map(t => `- ${t.name} (ID: ${t.id})`).join('\n')}

User message: "${userMessage}"

Current date: ${new Date().toISOString().split('T')[0]}

Extract and return JSON:
{
  "project_id": number | null,
  "project_name": string | null,
  "task_id": number | null,
  "task_name": string | null,
  "hours": number | null,
  "date": "YYYY-MM-DD" | null,
  "description": string,
  "confidence": 0-1,
  "create_new_task": boolean,
  "new_task_name": string | null
}
`;
```

**Task Filtering** (before AI):
```typescript
// src/services/taskFilter.ts
export class TaskFilter {
  filterTasks(tasks: OdooTask[], query: string, options?: FilterOptions): OdooTask[] {
    const fuse = new Fuse(tasks, {
      keys: ['name'],
      threshold: 0.6, // Fuzzy match tolerance
    });
    return fuse.search(query, { limit: options?.limit || 5 })
      .map(result => result.item);
  }
}
```

**Token Optimization**: Only top 5 tasks sent to AI (99%+ reduction for large projects).

### Cache Services

**Project Cache** (`src/services/cache.ts`):
```typescript
export class Cache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private defaultTTL: number;
  
  get(key: string): T | null
  set(key: string, data: T, ttl?: number): void
  clear(key: string): void
  startCleanup(interval: number): void // Auto-cleanup expired entries
}
```

**Response Cache** (`src/services/responseCache.ts`):
```typescript
export class ResponseCache {
  // Semantic hashing for AI responses
  // SHA-256 hash of normalized input
  
  async getOrSet<T>(
    input: string,
    model: string,
    factory: () => Promise<T>
  ): Promise<T>
  
  // Tracks hit rate for monitoring
  getStats(): { hits: number; misses: number; hitRate: number }
}
```

### Resilience Service (`src/services/resilience.ts`)

**Purpose**: Graceful degradation when Odoo unavailable.

**Offline Queue**:
```typescript
interface QueuedOperation {
  id: string;
  operation: 'logTime' | 'createTimeEntry';
  data: TimesheetEntry;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
}

export class OfflineQueue {
  async enqueue(operation: QueuedOperation): Promise<void>
  async processQueue(): Promise<void> // Called when Odoo recovers
  private startProcessing(interval: number): void // Auto-retry every 30s
}
```

**Execution Pattern**:
```typescript
async executeWithFallback<T>(
  primaryOperation: () => Promise<T>,
  fallbackResponse: T,
  options: { enableQueue?: boolean }
): Promise<T> {
  try {
    return await primaryOperation();
  } catch (error) {
    if (this.isRecoverable(error)) {
      await this.queue.enqueue(operation);
    }
    return fallbackResponse;
  }
}
```

### Health Service (`src/services/health.ts`)

**Purpose**: Health monitoring and Prometheus metrics.

**Endpoints**:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Returns health status with checks |
| `GET /metrics` | Prometheus metrics |

**Health Check Response**:
```json
{
  "status": "healthy" | "degraded" | "unhealthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600000,
  "checks": [
    { "name": "odoo", "status": "healthy", "latency_ms": 50 },
    { "name": "gemini", "status": "healthy" }
  ],
  "metrics": {
    "total_timesheets": 1234,
    "successful_parses": 1200,
    "failed_parses": 34,
    "cache_hit_rate": 0.85
  }
}
```

## Middleware Layers

### Error Recovery (`src/middleware/errorRecovery.ts`)

**Error Classification**:
```typescript
enum ErrorCategory {
  NETWORK = 'network',           // ECONNRESET, ECONNREFUSED, ETIMEDOUT
  AUTHENTICATION = 'authentication', // 401, invalid credentials
  RATE_LIMIT = 'rate_limit',     // 429, too many requests
  VALIDATION = 'validation',     // Invalid input
  SERVICE_UNAVAILABLE = 'service_unavailable', // 503
  INTERNAL = 'internal'          // Unexpected errors
}

enum ErrorSeverity {
  LOW = 'low',           // Recoverable, auto-retry
  MEDIUM = 'medium',     // Recoverable with user action
  HIGH = 'high',         // Requires admin intervention
  CRITICAL = 'critical' // System down
}
```

**Recovery Strategies**:
```typescript
class ErrorRecoveryService {
  // Built-in strategies:
  // - NETWORK: Retry with exponential backoff
  // - RATE_LIMIT: Wait and retry
  // - AUTHENTICATION: Prompt user to reconnect
  // - SERVICE_UNAVAILABLE: Queue for later
  
  addStrategy(category: ErrorCategory, strategy: RecoveryStrategy): void
  async handle<T>(fn: () => Promise<T>, context: Record<string, any>): Promise<T>
}
```

### Rate Limiting (`src/middleware/rateLimit.ts`)

**Implementation**:
```typescript
interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyGenerator?: (context: TurnContext) => string;
}

// Per-user limiting by default
const defaultConfig: RateLimitConfig = {
  windowMs: 60000,       // 1 minute
  maxRequests: 30,       // 30 messages per minute
  keyGenerator: (ctx) => ctx.activity.from.id
};
```

### Input Sanitization (`src/utils/sanitization.ts`)

**XSS Prevention**:
```typescript
function escapeHTML(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
```

**SQL Injection Prevention**:
```typescript
function sanitizeSQL(input: string): string {
  // Remove SQL injection patterns
  const sqlPatterns = [
    /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b)/gi,
    /(--|\|{2}|\/\*|\*\/)/g,
    /(\b(OR|AND)\b\s*\d+\s*[=<>]/gi,
  ];
  let sanitized = input;
  sqlPatterns.forEach(pattern => {
    sanitized = sanitized.replace(pattern, '');
  });
  return sanitized;
}
```

## Request Flow

```
User Message (Teams)
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. POST /api/messages                                        │
│    - BotFrameworkAdapter validates request                  │
│    - Activity dispatched to TimesheetBot                    │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. TimesheetBot.onMessage()                                 │
│    - Extract user email from Teams context                  │
│    - Check/create conversation reference                   │
│    - Sanitize user input                                    │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Response cache check                                     │
│    - Semantic hash of normalized input                      │
│    - If cached: Return previous parsed result               │
│    - Else: Continue to parser                              │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Fetch projects from Odoo                                 │
│    - Check project cache                                    │
│    - If cache miss: Fetch from Odoo via XML-RPC             │
│    - Cache result                                           │
│    - Identify project from user message                     │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Task filtering (if project identified)                   │
│    - Fetch all tasks for project                            │
│    - Use Fuse.js to filter top 5 matches                    │
│    - Send filtered tasks to AI parser                      │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Gemini AI Parser                                         │
│    - Build prompt with projects, tasks, date                │
│    - Call Gemini API                                        │
│    - Parse JSON response                                    │
│    - Validate parsed data                                   │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Generate Adaptive Card confirmation                      │
│    - Create TimesheetCard with parsed data                 │
│    - Include Confirm/Cancel actions                        │
│    - Cache AI response for future similar queries           │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 8. User action handling                                     │
│    - CONFIRM: Submit timesheet to Odoo                      │
│      - Calculate user_id (email mapping in admin_proxy)    │
│      - Create account.analytic.line record                 │
│      - Log audit event                                      │
│    - CANCEL: End conversation                               │
│    - EDIT: Return to editing state                          │
└─────────────────────────────────────────────────────────────┘
```

## Testing Strategy

### Test Structure
Tests mirror the `src/` structure in `test/`:

```
test/
├── bot.test.ts              # Bot activity handler tests
├── bot.adminProxy.test.ts   # Admin proxy mode tests
├── index.test.ts            # Entry point tests
├── setup.ts                 # Jest setup
│
├── services/
│   ├── odoo.test.ts         # OdooService tests
│   ├── parser.test.ts       # ParserService tests
│   ├── cache.test.ts        # Cache tests
│   ├── taskFilter.test.ts   # TaskFilter tests
│   ├── resilience.test.ts   # OfflineQueue tests
│   ├── responseCache.test.ts# ResponseCache tests
│   ├── audit.test.ts        # AuditService tests
│   ├── health.test.ts       # HealthService tests
│   ├── userMapping.test.ts  # UserMappingService tests
│   ├── oauth.test.ts        # OAuthService tests
│   └── apiKeyAuth.test.ts   # ApiKeyAuthService tests
│
├── middleware/
│   ├── errorHandler.test.ts # ErrorHandler tests
│   ├── errorRecovery.test.ts# ErrorRecovery tests
│   └── rateLimit.test.ts    # Rate limiter tests
│
├── utils/
│   ├── validation.test.ts   # Validation tests
│   ├── formatting.test.ts   # Formatting tests
│   ├── sanitization.test.ts # Sanitization tests
│   └── retry.test.ts        # Retry tests
│
└── config/
    └── configValidation.test.ts # Config validation tests
```

### Test Patterns

**Mocking External Dependencies**:
```typescript
// test/services/odoo.test.ts
jest.mock('xmlrpc', () => ({
  createClient: jest.fn(() => mockXmlRpcClient),
  createSecureClient: jest.fn(() => mockXmlRpcClient),
}));

// Test setup
beforeEach(() => {
  jest.clearAllMocks();
  mockCommonClient = {
    methodCall: jest.fn()
  };
  mockObjectClient = {
    methodCall: jest.fn()
  };
});
```

**Arrange-Act-Assert Pattern**:
```typescript
describe('OdooService', () => {
  describe('authenticate', () => {
    it('should successfully authenticate with valid credentials', async () => {
      // Arrange
      mockCommonClient.methodCall.mockImplementation((method, args, cb) => {
        cb(null, 1); // uid = 1
      });

      // Act
      const uid = await odooService['authenticate']();

      // Assert
      expect(uid).toBe(1);
      expect(mockCommonClient.methodCall).toHaveBeenCalledWith(
        'authenticate',
        [config.db, config.username, config.password, {}],
        expect.any(Function)
      );
    });
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- odoo.test.ts

# Run with coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## Configuration

### Environment Variables (`.env`)

```bash
# Bot Configuration
BOT_ID=your-bot-id
BOT_PASSWORD=your-bot-password  # Not required for Managed Identity
PORT=3978

# Azure Managed Identity (Recommended for Production)
AZURE_USE_MANAGED_IDENTITY=true
AZURE_CLIENT_ID=<managed-identity-client-id>  # For user-assigned managed identity
AZURE_TENANT_ID=<azure-tenant-id>              # Optional, for single-tenant bots

# Odoo Configuration
ODOO_URL=https://your-odoo-instance.com
ODOO_DB=your-database-name

# Authentication Mode: admin_proxy | api_key | oauth | service_account
AUTH_MODE=admin_proxy

# For admin_proxy mode (RECOMMENDED)
ODOO_USERNAME=admin@yourcompany.com
ODOO_PASSWORD=your-admin-password

# For oauth mode
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

### Azure ManagedIdentity

**Recommended for production deployments in Azure.** Managed Identity eliminates the need to manage and rotate client secrets.

#### How It Works:

1. **User-Assigned Managed Identity**: Azure creates a managed identity for your bot
2. **No Password Required**: `BOT_PASSWORD` is not needed when `AZURE_USE_MANAGED_IDENTITY=true`
3. **Automatic Authentication**: Azure handles token acquisition and renewal
4. **Local Development**: Falls back to Azure CLI credentials or environment variables

#### Configuration:

| Variable | Description | Required |
|----------|-------------|----------|
| `AZURE_USE_MANAGED_IDENTITY` | Set to `true` to enable | Yes (for MI) |
| `BOT_ID` | Microsoft App ID from Azure Bot | Yes |
| `AZURE_CLIENT_ID` | User-assigned managed identity client ID | For user-assigned MI |
| `AZURE_TENANT_ID` | Azure tenant ID | Optional |

#### Setup Steps:

1. Create Azure Bot with "User-assigned managed identity"
2. Create a User-Assigned Managed Identity resource
3. Assign the managed identity to your App Service
4. Set `AZURE_USE_MANAGED_IDENTITY=true` and configure environment variables

### Schema Validation (`src/config/configValidation.ts`)

Configuration is validated at startup using schema:

```typescript
const configSchema = {
  BOT_ID: { required: true, type: 'string' },
  BOT_PASSWORD: { required: true, type: 'string' },
  ODOO_URL: { required: true, type: 'string' },
  ODOO_DB: { required: true, type: 'string' },
  AUTH_MODE: { 
    required: true, 
    type: 'string',
    enum: ['admin_proxy', 'api_key', 'oauth', 'service_account']
  },
  GEMINI_API_KEY: { required: true, type: 'string' },
  // ... more
};
```

## Development Workflow for AI Agents

### Adding New Features

1. **Create/Update Type Definitions** (if needed)
   - Add interfaces to `src/types/`
   - Export from `src/types/index.ts`

2. **Create/Update Service**
   - Add business logic to `src/services/`
   - Follow singleton pattern for shared services
   - Implement proper error handling with `ErrorRecoveryService`

3. **Create/Update Bot Handler**
   - Add command handling in `src/bot.ts`
   - Use Adaptive Cards for UI
   - Sanitize all user inputs

4. **Write Tests**
   - Mirror structure in `test/`
   - Mock external dependencies
   - Test happy path + error cases

5. **Update Documentation**
   - Update CLAUDE.md if architecture changes
   - Update AGENTS.md if integration patterns change

### Debugging Tips

**Enable Debug Logging**:
```bash
LOG_LEVEL=debug npm run dev
```

**Check Health Endpoint**:
```bash
curl http://localhost:3978/health
```

**View Logs**:
```bash
tail -f logs/bot.log
```

**Check Cache State**:
```typescript
// In bot.ts
import { OdooService } from './services/odoo';
const odoo = new OdooService(config);
console.log('Project cache:', odoo['projectCache']);
```

### Common Issues

**Issue**: "No Odoo user found" error in admin_proxy mode.
**Cause**: User's Teams email doesn't match Odoo login.
**Solution**: 
- Verify email matches in Odoo `res.users` table
- Check user account is active
- Use `status` command to see detected email

**Issue**: Gemini API timeout.
**Cause**: Large number of tasks being sent to AI.
**Solution**: Task filtering should reduce token usage. Check `TaskFilter` is being applied.

**Issue**: Offline queue not processing.
**Cause**: Odoo still unavailable or queue processing not started.
**Solution**: Check health endpoint for Odoo status. Queue auto-processes every 30s.

## Key Files to Understand

| File | Purpose | Lines |
|------|---------|-------|
| `src/bot.ts` | Main bot activity handler | ~600 |
| `src/services/odoo.ts` | Odoo XML-RPC integration | ~470 |
| `src/services/parser.ts` | Gemini AI integration | ~250 |
| `src/services/resilience.ts` | Offline queue, graceful degradation | ~300 |
| `src/middleware/errorRecovery.ts` | Error classification & recovery | ~400 |
| `src/utils/sanitization.ts` | Input sanitization (XSS/SQL injection) | ~230 |
| `src/config/configValidation.ts` | Schema-based config validation | ~150 |

## Performance Considerations

- **Project Caching**: 1hr TTL reduces Odoo API calls
- **Task Filtering**: Fuse.js reduces AI token usage by 99%+ for large projects
- **Response Caching**: Semantic hash caches AI responses for repeated queries
- **User Lookup Caching**: 1hr TTL for successful, 5min for failed lookups
- **Rate Limiting**: Prevents abuse (30 req/min default per user)
- **Offline Queue**: Allows system to continue operating when Odoo is down

## Security Checklist

- [x] Input sanitization (XSS, SQL injection)
- [x] Rate limiting per user
- [x] Token encryption (AES-256-GCM for OAuth tokens)
- [x] Audit trail logging
- [x] Configuration validation at startup
- [x] PKCE for OAuth flows
- [x] Secure credential storage
- [x] No hardcoded secrets
- [x] Error messages don't leak sensitive data

## CI/CD Pipeline

GitHub Actions workflow (`.github/workflows/ci.yml`):

```yaml
jobs:
  build:
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm run test:coverage
      - run: npm run build
      - uses: github/codeql-action/analyze@v2
      - uses: docker/build-push-action@v4
```

## Deployment

### Docker

```dockerfile
# Multi-stage build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3978
CMD ["node", "dist/index.js"]
```

### Docker Compose

```yaml
services:
  odoo-teams-bot:
    build: .
    ports:
      - "3978:3978"
    environment:
      - NODE_ENV=production
    env_file:
      - .env
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
```

## Monitoring

### Health Endpoint
```bash
curl http://localhost:3978/health
```

### Prometheus Metrics
```bash
curl http://localhost:3978/metrics
```

### Log Files
- Location: `logs/bot.log`
- Rotation: Daily
- Format: JSON

### Key Metrics
- `total_timesheets`: Total timesheet entries logged
- `successful_parses`: Successful AI parsing count
- `failed_parses`: Failed parsing count
- `cache_hit_rate`: Project/response cache hit rate
- `offline_queue_size`: Pending operations in queue

---

## Server Access

### Production Server
```bash
ssh root@142.171.21.124
```

## Server Deployment

### Server Overview

| Property | Value |
|----------|-------|
| Host | `142.171.21.124` |
| Domain | `https://spacewa.lk` |
| App Location | `/opt/odoo-teams-bot/` |
| Port | `3978` |
| Process Manager | PM2 |
| Service Name | `odoo-teams-bot` |

### Server Directory Structure

```
/opt/odoo-teams-bot/
├── src/                    # TypeScript source code
├── dist/                   # Compiled JavaScript (production)
├── dist.bak/               # Backup of previous build
├── test/                   # Jest test suite
├── teams-app/              # Microsoft Teams app package
│   ├── manifest.json        # Teams app manifest
│   ├── color.png           # App icon (32x32)
│   └── outline.png          # App icon outline (32x32)
├── data/                   # Runtime data directory
│   ├── tokens.db            # SQLite token storage (encrypted)
│   └── offline-queue.json   # Queued operations when Odoo unavailable
├── logs/                    # Winston log files
│   └── bot.log              # Daily rotating log (JSON format)
├── node_modules/            # Dependencies
├── package.json             # Project manifest
├── .env                     # Environment variables (secrets)
└── .git/                    # Git repository

PM2 logs:
├── /root/.pm2/logs/odoo-teams-bot-out.log     # stdout
└── /root/.pm2/logs/odoo-teams-bot-error.log   # stderr
```

### PM2 Process Management

```bash
# View process status
pm2 status

# View logs
pm2 logs odoo-teams-bot

# Restart service
pm2 restart odoo-teams-bot

# Stop service
pm2 stop odoo-teams-bot

# Monitor in real-time
pm2 monit
```

### Deployment Workflow

1. **Development** (local):
   ```bash
   npm run dev        # Development with ts-node
   npm run build      # Compile TypeScript
   ```

2. **Deploy to Production**:
   ```bash
   # On server:
   cd /opt/odoo-teams-bot
   git pull            # Pull latest from main branch
   npm run build       # Compile TypeScript
   pm2 restart odoo-teams-bot  # Restart service
   ```

3. **Health Verification**:
   ```bash
   curl https://spacewa.lk/health
   # Returns: {"status":"healthy","timestamp":"...","authMode":"admin_proxy"}
   ```

### Key Server Paths

| Purpose | Path |
|---------|------|
| App root | `/opt/odoo-teams-bot/` |
| Logs | `/opt/odoo-teams-bot/logs/` |
| PM2 logs | `/root/.pm2/logs/` |
| Data | `/opt/odoo-teams-bot/data/` |
| Dist (entry point) | `/opt/odoo-teams-bot/dist/index.js` |

### Teams App Package

The `teams-app/` directory contains the Microsoft Teams app manifest and icons:
- `manifest.json` - Teams app configuration (app ID, permissions, etc.)
- `color.png` - 32x32 color icon
- `outline.png` - 32x32 outline icon

To update the Teams app:
1. Modify files in `teams-app/`
2. Zip into `odoo-timesheet-bot.zip`
3. Upload to Azure Bot Framework / Teams admin center

---

## Changelog

| Date | Change |
|------|--------|
| 2024-01 | Initial AGENTS.md creation |
| 2024-01 | Added admin_proxy mode documentation |
| 2024-01 | Added resilience and offline queue |
| 2024-01 | Added Fuse.js task filtering |
| 2026-04-03 | Added server deployment documentation (paths, PM2, Teams app) |

---

**For questions or issues**, check the logs first, then refer to COMPREHENSIVE_DOCUMENTATION.md for detailed API reference.
