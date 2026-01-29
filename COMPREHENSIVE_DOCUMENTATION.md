# Odoo Teams Bot - Comprehensive Technical Documentation

## Table of Contents
1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Component Breakdown](#component-breakdown)
4. [API Documentation](#api-documentation)
5. [Configuration](#configuration)
6. [Security](#security)
7. [Resilience & Reliability](#resilience--reliability)
8. [Performance](#performance)
9. [Deployment](#deployment)
10. [Testing](#testing)
11. [Troubleshooting](#troubleshooting)
12. [Development Guide](#development-guide)

---

## Project Overview

### Executive Summary
The Odoo Teams Bot is a production-ready Microsoft Teams bot that leverages artificial intelligence to automatically parse natural language timesheet entries and log them to Odoo ERP. The bot provides a conversational interface for employees to log work hours using plain English, eliminating the need for complex form filling.

### Key Features
- **Natural Language Processing**: Google Gemini AI parses free-form text into structured timesheet data
- **Adaptive Cards UI**: Rich, interactive confirmation cards in Microsoft Teams
- **Automatic Project Matching**: Intelligent fuzzy matching of project names/codes from Odoo
- **Offline Queue**: Graceful degradation when Odoo is unavailable
- **Comprehensive Audit Trail**: Complete logging of all user actions for compliance
- **Input Sanitization**: Protection against XSS, SQL injection, and other attack vectors
- **Rate Limiting**: Per-user and per-endpoint throttling to prevent abuse
- **Health Monitoring**: Prometheus metrics and health check endpoints
- **Caching Strategy**: Multi-layer caching to reduce API costs and latency

### Technology Stack
- **Runtime**: Node.js v20+ (TypeScript 5.3)
- **Bot Framework**: Microsoft BotBuilder SDK v4.20
- **Server**: Restify v11.1
- **AI**: Google Gemini AI (generative-ai v0.1.3)
- **ERP Integration**: Odoo XML-RPC (xmlrpc v1.3.2)
- **Logging**: Winston v3.11 with file rotation
- **UI**: Adaptive Cards v3.0
- **Testing**: Jest v29.7 + ts-jest
- **CI/CD**: GitHub Actions
- **Containerization**: Docker with multi-stage builds

---

## Architecture

### System Design Overview

```
┌─────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│  MS Teams       │─────▶│  Restify Server  │─────▶│  Odoo ERP       │
│  Client         │      │  (Port 3978)     │      │  (XML-RPC)      │
└─────────────────┘      └──────────────────┘      └─────────────────┘
                                │
                                ▼
                        ┌──────────────────┐      ┌─────────────────┐
                        │  BotBuilder      │─────▶│  Gemini AI      │
                        │  Framework       │      │  (Parser)       │
                        └──────────────────┘      └─────────────────┘
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
            ┌───────────────┐       ┌──────────────┐
            │  Cache Layer  │       │  Audit Log   │
            │  (Projects)   │       │  (JSONL)     │
            └───────────────┘       └──────────────┘
```

### Request Flow

```
User Message (Teams)
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 1. Message received by /api/messages endpoint           │
│ 2. BotFrameworkAdapter authenticates request            │
│ 3. TimesheetBot.onMessage() triggered                  │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 4. Fetch projects from Odoo (with cache check)          │
│ 5. Parse text using Gemini AI                           │
│ 6. Validate parsed data                                 │
└─────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│ 7. Generate Adaptive Card confirmation                  │
│ 8. Send card to user                                   │
│ 9. Await user action (Confirm/Cancel)                  │
└─────────────────────────────────────────────────────────┘
    │
    ▼ (User clicks Confirm)
┌─────────────────────────────────────────────────────────┐
│ 10. handleAdaptiveCardInvoke() triggered               │
│ 11. Create timesheet in Odoo (with retry)              │
│ 12. Log audit event                                    │
│ 13. Send success card                                  │
└─────────────────────────────────────────────────────────┘
```

### Component Architecture

```
src/
├── index.ts                      # Entry point: HTTP server setup
├── bot.ts                        # Core bot logic and activity handling
├── config/
│   ├── config.ts                 # Environment configuration
│   ├── configValidation.ts       # Schema-based config validation
│   └── logger.ts                 # Winston logger setup
├── services/
│   ├── odoo.ts                   # Odoo XML-RPC client
│   ├── parser.ts                 # Gemini AI NLP parser
│   ├── cache.ts                  # Generic in-memory cache
│   ├── responseCache.ts          # AI response caching
│   ├── audit.ts                  # Audit trail service
│   ├── health.ts                 # Health checks & metrics
│   └── resilience.ts             # Offline queue & fallback
├── cards/
│   └── timesheetCard.ts          # Adaptive Card generators
├── middleware/
│   ├── errorHandler.ts           # Error handling utilities
│   ├── errorRecovery.ts          # Error classification & recovery
│   └── rateLimit.ts              # Rate limiting middleware
├── utils/
│   ├── validation.ts             # Input validation
│   ├── formatting.ts             # Date/time formatting
│   ├── sanitization.ts           # XSS/SQL injection prevention
│   └── retry.ts                  # Retry with exponential backoff
└── types/
    ├── index.ts                  # Core type definitions
    ├── bot.types.ts              # Bot-specific types
    └── odoo.types.ts             # Odoo integration types
```

### Data Models

#### TimesheetEntry
```typescript
interface TimesheetEntry {
  project_id: number;           // Odoo project ID
  project_name: string;         // Project name for display
  hours: number;                // Hours worked (0.25 - 24)
  date: string;                 // YYYY-MM-DD format
  description: string;          // Work description
  user_id?: number;             // Odoo user ID (optional)
}
```

#### ParsedTimesheetData
```typescript
interface ParsedTimesheetData {
  project_id: number | null;    // Extracted project ID
  project_name: string | null;  // Extracted project name
  hours: number | null;         // Extracted hours
  date: string | null;          // Extracted date
  description: string;          // Full description
  confidence: number;           // AI confidence score (0-1)
  error?: string;               // Error message if parsing failed
}
```

#### OdooProject
```typescript
interface OdooProject {
  id: number;                   // Project ID in Odoo
  name: string;                 // Project name
  code?: string;                // Project code (optional)
  active: boolean;              // Active status
}
```

---

## Component Breakdown

### 1. Entry Point (`src/index.ts`)

**Purpose**: Initialize and start the Restify HTTP server.

**Key Responsibilities**:
- Create BotFramework adapter with authentication
- Set up error handling for uncaught exceptions
- Configure HTTP endpoints
- Implement graceful shutdown

**Endpoints**:
- `GET /health` - Health check endpoint
- `POST /api/messages` - Bot messaging endpoint

**Error Handling**:
```typescript
adapter.onTurnError = async (context, error) => {
  logger.error('Unhandled error in bot adapter', {
    error: error.message,
    stack: error.stack,
    activity: context.activity
  });
  await context.sendActivity('Sorry, an unexpected error occurred...');
};
```

### 2. Bot Core (`src/bot.ts`)

**Purpose**: Handle Teams activity and coordinate service interactions.

**Key Methods**:

#### `onMessage(context, next)`
- Triggers on incoming user messages
- Fetches projects from Odoo (cached)
- Parses text using Gemini AI
- Generates confirmation card
- Validates parsed data

#### `handleAdaptiveCardInvoke(context, invokeValue)`
- Handles card button clicks (Confirm/Cancel)
- Routes to appropriate handler based on verb

#### `handleSaveTimesheet(context, data)`
- Creates timesheet in Odoo
- Logs audit event
- Returns success/error card

**Error Handling Flow**:
```typescript
try {
  const parsed = await parserService.parseText(userText, projects);
  if (parsed.error || !parsed.project_id || !parsed.hours || !parsed.date) {
    const errorMsg = this.buildErrorMessage(parsed);
    const errorCard = TimesheetCardGenerator.createErrorCard(errorMsg, userText);
    await context.sendActivity({ attachments: [errorCard] });
    return;
  }
  // ... continue with confirmation
} catch (error) {
  logger.error('Error handling message', { error });
  await context.sendActivity('An error occurred while processing your request...');
}
```

### 3. Odoo Service (`src/services/odoo.ts`)

**Purpose**: Interface with Odoo ERP via XML-RPC.

**Key Methods**:

#### `authenticate(): Promise<number>`
- Authenticates with Odoo
- Caches user ID (`this.uid`)
- Throws error on invalid credentials

**Implementation**:
```typescript
private async authenticate(): Promise<number> {
  if (this.uid) {
    return this.uid;
  }
  return new Promise((resolve, reject) => {
    this.commonClient.methodCall('authenticate', [
      this.config.db,
      this.config.username,
      this.config.password,
      {}
    ], (error: any, uid: number) => {
      if (error || !uid) {
        reject(new Error('Odoo authentication failed'));
      }
      this.uid = uid;
      resolve(uid);
    });
  });
}
```

#### `getProjects(): Promise<OdooProject[]>`
- Fetches active projects from Odoo
- Implements caching (TTL: 1 hour)
- Returns array of `OdooProject`

**Odoo Model Operations**:
- Model: `project.project`
- Search: `[['active', '=', true]]`
- Read: `['id', 'name', 'code', 'active']`

#### `logTime(entry: TimesheetEntry): Promise<number>`
- Creates timesheet entry in Odoo
- Model: `account.analytic.line`
- Returns: Created timesheet ID

**Fields Mapped**:
```typescript
{
  project_id: entry.project_id,
  name: entry.description,        // Description field
  unit_amount: entry.hours,       // Hours
  date: entry.date,               // YYYY-MM-DD
  user_id: entry.user_id || uid   // Odoo user ID
}
```

**Security**:
- Supports both HTTP and HTTPS
- URL parsing for port detection
- Credential validation

### 4. Parser Service (`src/services/parser.ts`)

**Purpose**: Parse natural language using Google Gemini AI.

**Key Method**: `parseText(userText, projectList)`

**Prompt Engineering**:
```
You are a timesheet entry parser. Extract structured data from the user's natural language input.

Available Projects:
- ID: 123, Name: "Website Redesign"
- ID: 456, Name: "Mobile App", Code: "MOB"

Today's Date: 2024-01-15

User Input: "{userText}"

Instructions:
1. Identify the project from the available projects list
2. Extract hours (formats: "4 hours", "4h", "4.5 hours")
3. Determine date (defaults to today if not mentioned)
4. Extract work description

Output ONLY valid JSON:
{
  "project_id": <number or null>,
  "project_name": "<string or null>",
  "hours": <number or null>,
  "date": "<YYYY-MM-DD or null>",
  "description": "<string>",
  "confidence": <0-1>
}
```

**Validation**:
- Type checking for all fields
- Date format validation (YYYY-MM-DD)
- Confidence score normalization (0-1)
- Null safety checks

**Error Handling**:
- Returns safe fallback on parsing failure
- Logs error details
- Includes error message in response

### 5. Cache Service (`src/services/cache.ts`)

**Purpose**: Generic in-memory caching with TTL support.

**Implementation**:
```typescript
export class Cache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();

  set(key: string, data: T, ttl: number): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl
    });
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }
}
```

**Features**:
- Automatic expiration
- Periodic cleanup (default: 5 minutes)
- Type-safe generics
- Debug logging

### 6. Response Cache (`src/services/responseCache.ts`)

**Purpose**: Cache AI API responses to reduce costs.

**Key Features**:
- Semantic hashing for cache keys
- Hit/miss tracking
- Max size enforcement
- Lazy loading with `getOrSet()`

**Cache Key Generation**:
```typescript
private generateHash(input: string): string {
  const normalized = input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '');

  return crypto
    .createHash('sha256')
    .update(normalized)
    .digest('hex')
    .substring(0, 16);
}
```

**Presets**:
```typescript
const CachePresets = {
  AI_RESPONSES: {
    defaultTtl: 7200000,  // 2 hours
    maxCacheSize: 500
  },
  PROJECT_LIST: {
    defaultTtl: 3600000,  // 1 hour
    maxCacheSize: 100
  }
};
```

### 7. Audit Service (`src/services/audit.ts`)

**Purpose**: Track all user actions and system events.

**Event Types**:
```typescript
enum AuditEventType {
  // User actions
  TIMESHEET_CREATE = 'timesheet.create',
  TIMESHEET_UPDATE = 'timesheet.update',
  TIMESHEET_DELETE = 'timesheet.delete',

  // System events
  SYSTEM_START = 'system.start',
  SYSTEM_ERROR = 'system.error',

  // Security events
  AUTH_FAILURE = 'auth.failure',
  RATE_LIMIT_EXCEEDED = 'rate_limit.exceeded',

  // API events
  API_CALL = 'api.call',
  API_SUCCESS = 'api.success',
  API_FAILURE = 'api.failure'
}
```

**Batch Writing**:
- Batches events (default: 100)
- Flushes every 10 seconds
- Persists to JSONL file

**Query Interface**:
```typescript
await auditService.query({
  userId: 'user123',
  eventType: AuditEventType.TIMESHEET_CREATE,
  startDate: new Date('2024-01-01'),
  endDate: new Date('2024-01-31'),
  limit: 1000
});
```

### 8. Health Service (`src/services/health.ts`)

**Purpose**: Monitor system health and provide metrics.

**Health Check Endpoint**:
```typescript
GET /health
```

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600000,
  "version": "1.0.0",
  "environment": "production",
  "checks": [
    {
      "name": "memory",
      "status": "pass",
      "message": "Memory usage: 45.23%"
    },
    {
      "name": "odoo",
      "status": "pass",
      "duration": 234
    }
  ],
  "metrics": {
    "memory": { "used": 123456789, "total": 273678336 },
    "cache": { "aiCache": { "size": 42, "hitRate": 0.78 } }
  }
}
```

**Prometheus Metrics**:
```
GET /metrics
```

Output:
```
# HELP app_uptime_seconds Application uptime in seconds
# TYPE app_uptime_seconds gauge
app_uptime_seconds 3600

# HELP app_memory_bytes Application memory usage
# TYPE app_memory_bytes gauge
app_memory_bytes{type="heap_used"} 123456789

# HELP app_cache_hit_rate Cache hit rate
# TYPE app_cache_hit_rate gauge
app_cache_hit_rate{name="ai"} 0.78
```

### 9. Resilience Service (`src/services/resilience.ts`)

**Purpose**: Provide graceful degradation and offline queuing.

**Offline Queue**:
- Persists to `data/offline-queue.json`
- Processes every 30 seconds
- Max 1000 operations (FIFO eviction)
- Max 5 retries per operation

**Execute with Fallback**:
```typescript
await resilienceService.executeWithFallback(
  () => odooService.logTime(entry),
  () => {
    // Fallback: add to queue
    return { success: false, queued: true };
  },
  {
    operationName: 'create_timesheet',
    userId: context.activity.from.id,
    enableQueue: true,
    queueData: entry
  }
);
```

**Queue Status**:
```typescript
{
  size: 42,
  enabled: true,
  odooAvailable: true,
  processing: false
}
```

### 10. Error Recovery (`src/middleware/errorRecovery.ts`)

**Purpose**: Classify errors and apply recovery strategies.

**Error Categories**:
```typescript
enum ErrorCategory {
  NETWORK = 'network',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  VALIDATION = 'validation',
  RATE_LIMIT = 'rate_limit',
  SERVICE_UNAVAILABLE = 'service_unavailable',
  TIMEOUT = 'timeout',
  UNKNOWN = 'unknown'
}
```

**Classification Logic**:
```typescript
if (errorCode === 'ECONNRESET' || errorMessage.includes('network')) {
  category = ErrorCategory.NETWORK;
  recoverable = true;
  retryable = true;
}

if (errorMessage.includes('authentication') || status === 401) {
  category = ErrorCategory.AUTHENTICATION;
  recoverable = false;  // Requires user intervention
  retryable = false;
}
```

**Recovery Strategies**:
```typescript
// Network errors: Wait 1s and retry
if (category === ErrorCategory.NETWORK) {
  await delay(1000);
  return { retry: true };
}

// Rate limits: Wait for Retry-After header
if (category === ErrorCategory.RATE_LIMIT) {
  const waitTime = extractRetryAfter(context) || 60000;
  await delay(waitTime);
  return { retry: true };
}
```

### 11. Rate Limiting (`src/middleware/rateLimit.ts`)

**Purpose**: Prevent abuse and API quota exhaustion.

**Algorithm**: Sliding Window

**Implementation**:
```typescript
class RateLimiter {
  private requests: Map<string, RateLimitEntry> = new Map();

  middleware() {
    return (req, res, next) => {
      const key = keyGenerator(req);
      const entry = this.requests.get(key);

      if (!entry || isExpired(entry)) {
        entry = { count: 1, windowStart: now, resetTime: now + windowMs };
        this.requests.set(key, entry);
      } else {
        entry.count++;
      }

      if (entry.count > maxRequests) {
        return errorHandler(req, res);
      }

      next();
    };
  }
}
```

**Presets**:
```typescript
const RateLimitPresets = {
  AI_OPERATIONS: {
    requests: 30,
    windowMs: 60000  // 1 minute
  },
  API_CALLS: {
    requests: 100,
    windowMs: 60000
  },
  BOT_MESSAGES: {
    requests: 20,
    windowMs: 60000
  }
};
```

**Headers**:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 2024-01-15T10:31:00.000Z
```

### 12. Retry Mechanism (`src/utils/retry.ts`)

**Purpose**: Execute operations with exponential backoff.

**Function Signature**:
```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T>
```

**Options**:
```typescript
interface RetryOptions {
  maxAttempts?: number;        // Default: 3
  initialDelay?: number;       // Default: 1000ms
  maxDelay?: number;           // Default: 30000ms
  backoffMultiplier?: number;  // Default: 2
  jitterFactor?: number;       // Default: 0.1
  shouldRetry?: (error, attempt) => boolean;
  onRetry?: (error, attempt) => void;
}
```

**Backoff Calculation**:
```typescript
const exponentialDelay = initialDelay * Math.pow(backoffMultiplier, attempt);
const jitter = exponentialDelay * jitterFactor * (Math.random() * 2 - 1);
const delay = Math.min(exponentialDelay + jitter, maxDelay);
```

**Presets**:
```typescript
const RetryPresets = {
  QUICK: {
    maxAttempts: 2,
    initialDelay: 500,
    maxDelay: 2000
  },
  STANDARD: {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000
  },
  EXTENDED: {
    maxAttempts: 5,
    initialDelay: 1000,
    maxDelay: 30000
  },
  PATIENT: {
    maxAttempts: 4,
    initialDelay: 2000,
    maxDelay: 60000
  }
};
```

**Usage**:
```typescript
await withRetry(
  () => odooService.logTime(entry),
  RetryPresets.STANDARD
);
```

### 13. Input Sanitization (`src/utils/sanitization.ts`)

**Purpose**: Prevent injection attacks and ensure data integrity.

**Functions**:

#### `sanitizeString(input, options)`
- Trims whitespace
- Enforces max length
- Removes null bytes
- Escapes HTML entities
- Removes control characters

#### `escapeHTML(input)`
```typescript
const htmlEntities = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '/': '&#x2F;'
};

return input.replace(/[&<>"'/]/g, (char) => htmlEntities[char]);
```

#### `sanitizeSQL(input)`
Removes SQL injection patterns:
- SQL keywords: SELECT, INSERT, UPDATE, DELETE, DROP, etc.
- SQL operators: ;, --, /*, */, @@, @
- OR/AND clauses
- Comment patterns

#### `sanitizeDate(input)`
- Validates YYYY-MM-DD format
- Checks date validity
- Enforces date range (2021-2029)

#### `sanitizeTimesheetInput(data)`
Comprehensive sanitization:
```typescript
{
  project_id: parseInt and validate > 0,
  project_name: sanitizeProjectName(),
  hours: sanitizeNumber(0.25, 24),
  date: sanitizeDate(),
  description: sanitizeDescription(),
  user_id: sanitizeUserId()
}
```

### 14. Adaptive Cards (`src/cards/timesheetCard.ts`)

**Purpose**: Generate rich, interactive UI elements for Teams.

#### Confirmation Card
```typescript
{
  type: 'AdaptiveCard',
  version: '1.4',
  body: [
    {
      type: 'TextBlock',
      text: 'Timesheet Entry',
      weight: 'Bolder',
      size: 'Large',
      color: 'Accent'
    },
    {
      type: 'FactSet',
      facts: [
        { title: 'Project:', value: 'Website Redesign' },
        { title: 'Hours:', value: '4 hours' },
        { title: 'Date:', value: 'Monday, January 15, 2024' },
        { title: 'Description:', value: 'Fixed payment gateway bug' }
      ]
    }
  ],
  actions: [
    {
      type: 'Action.Execute',
      title: 'Confirm',
      verb: 'save_timesheet',
      data: { /* timesheet data */ },
      style: 'positive'
    },
    {
      type: 'Action.Execute',
      title: 'Cancel',
      verb: 'cancel_timesheet',
      style: 'destructive'
    }
  ]
}
```

#### Error Card
- Displays error message
- Shows original input
- Provides example format
- Uses monospace font for examples

#### Success Card
- Checkmark emoji
- Confirmation message
- Summary of saved data
- Green color scheme

### 15. Configuration (`src/config/config.ts`)

**Purpose**: Load and validate environment variables.

**Validation**:
```typescript
class ConfigValidator {
  private static requiredEnvVars = [
    'BOT_ID',
    'BOT_PASSWORD',
    'ODOO_URL',
    'ODOO_DB',
    'ODOO_USERNAME',
    'ODOO_PASSWORD',
    'GEMINI_API_KEY'
  ];

  static validate(): void {
    const missing = this.requiredEnvVars.filter(
      varName => !process.env[varName]
    );
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
  }
}
```

**Configuration Schema**:
```typescript
interface Config {
  bot: {
    appId: string;
    appPassword: string;
    port: number;
  };
  odoo: OdooConfig;
  gemini: {
    apiKey: string;
    model: string;
  };
  cache: {
    projectTtl: number;
  };
  logging: {
    level: string;
    file: string;
  };
  environment: string;
}
```

### 16. Logger (`src/config/logger.ts`)

**Purpose**: Structured logging with file rotation.

**Transports**:
```typescript
new winston.transports.File({
  filename: 'logs/bot.log',
  maxsize: 10485760,  // 10MB
  maxFiles: 5,
  tailable: true
})

new winston.transports.File({
  filename: 'logs/error.log',
  level: 'error',
  maxsize: 10485760,
  maxFiles: 5
})
```

**Exception Handlers**:
- `logs/exceptions.log` - Uncaught exceptions
- `logs/rejections.log` - Unhandled promise rejections

**Format**:
```typescript
winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
)
```

**Console Output**:
- Development only
- Colorized
- Human-readable format

---

## API Documentation

### Bot Framework Endpoints

#### POST /api/messages
**Purpose**: Receive messages from Microsoft Teams

**Authentication**: BotFramework token (handled by adapter)

**Request Body**: Bot Framework Activity object

**Response**: 200 OK (async processing)

**Flow**:
1. BotFrameworkAdapter authenticates
2. TimesheetBot.run() executes
3. onMessage() handler processes text
4. Adaptive Card sent as response

---

### Health Check Endpoints

#### GET /health
**Purpose**: Basic health check for load balancers

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

**Status Codes**:
- 200: Bot is running
- 503: Bot is shutting down

---

#### GET /health/detailed
**Purpose**: Comprehensive health check with metrics

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 3600000,
  "version": "1.0.0",
  "environment": "production",
  "checks": [
    {
      "name": "memory",
      "status": "pass",
      "message": "Memory usage: 45.23%",
      "details": {
        "used": 123456789,
        "total": 273678336,
        "percentage": 45.23
      }
    },
    {
      "name": "cpu",
      "status": "pass",
      "message": "Load average: 1.23, 1.45, 1.56"
    },
    {
      "name": "odoo",
      "status": "pass",
      "duration": 234,
      "message": "Odoo API is responding"
    }
  ],
  "metrics": {
    "memory": { "used": 123456789, "total": 273678336 },
    "cpu": { "usage": 123.45, "loadAverage": [1.23, 1.45, 1.56] },
    "cache": {
      "aiCache": { "size": 42, "hits": 156, "misses": 44, "hitRate": 0.78 }
    },
    "api": {
      "odoo": { "status": "up", "lastCheck": "2024-01-15T10:29:00.000Z", "responseTime": 234 },
      "gemini": { "status": "up", "lastCheck": "2024-01-15T10:25:00.000Z" }
    }
  }
}
```

---

#### GET /metrics
**Purpose**: Prometheus metrics for monitoring

**Response Format**: Plain text (Prometheus format)

**Metrics**:
```
# Uptime
app_uptime_seconds 3600

# Memory
app_memory_bytes{type="heap_used"} 123456789
app_memory_bytes{type="heap_total"} 273678336

# Cache
app_cache_size{name="ai"} 42
app_cache_hits_total{name="ai"} 156
app_cache_misses_total{name="ai"} 44
app_cache_hit_rate{name="ai"} 0.78
```

---

### Service APIs

#### OdooService Methods

##### `authenticate(): Promise<number>`
Authenticates with Odoo and returns user ID.

**Returns**: Odoo user ID

**Throws**:
- `Error`: Authentication failed

**Example**:
```typescript
const uid = await odooService.authenticate();
console.log(`Authenticated as user ${uid}`);
```

---

##### `getProjects(): Promise<OdooProject[]>`
Fetches all active projects from Odoo with caching.

**Returns**: Array of active projects

**Caching**: Results cached for 1 hour (configurable)

**Example**:
```typescript
const projects = await odooService.getProjects();
console.log(`Found ${projects.length} projects`);
```

---

##### `logTime(entry: TimesheetEntry): Promise<number>`
Creates a timesheet entry in Odoo.

**Parameters**:
```typescript
{
  project_id: number;
  project_name: string;
  hours: number;
  date: string;        // YYYY-MM-DD
  description: string;
  user_id?: number;
}
```

**Returns**: Created timesheet ID

**Throws**:
- `Error`: Odoo API error

**Example**:
```typescript
const timesheetId = await odooService.logTime({
  project_id: 123,
  project_name: 'Website Redesign',
  hours: 4,
  date: '2024-01-15',
  description: 'Fixed payment gateway bug'
});
console.log(`Created timesheet ${timesheetId}`);
```

---

##### `clearCache(): void`
Clears the project cache.

**Example**:
```typescript
odooService.clearCache();
```

---

#### ParserService Methods

##### `parseText(userText: string, projectList: OdooProject[]): Promise<ParsedTimesheetData>`
Parses natural language timesheet text using Gemini AI.

**Parameters**:
- `userText`: Raw user input
- `projectList`: Available projects for matching

**Returns**:
```typescript
{
  project_id: number | null;
  project_name: string | null;
  hours: number | null;
  date: string | null;
  description: string;
  confidence: number;    // 0-1
  error?: string;
}
```

**Example**:
```typescript
const result = await parserService.parseText(
  'Spent 4 hours on SSI project fixing bugs',
  projects
);
console.log(result);
// { project_id: 123, project_name: 'SSI', hours: 4, date: '2024-01-15', confidence: 0.95 }
```

---

#### AuditService Methods

##### `log(event: Omit<AuditEvent, 'id' | 'timestamp'>): string`
Logs an audit event.

**Parameters**:
```typescript
{
  eventType: AuditEventType;
  userId?: string;
  action: string;
  resource?: string;
  resourceId?: string;
  details?: Record<string, any>;
  success: boolean;
  errorMessage?: string;
}
```

**Returns**: Audit event ID

**Example**:
```typescript
const eventId = auditService.log({
  eventType: AuditEventType.TIMESHEET_CREATE,
  userId: 'user123',
  action: 'Created timesheet entry',
  resource: 'timesheet',
  resourceId: '456',
  details: { projectId: 123, hours: 4 },
  success: true
});
```

---

##### `query(options): Promise<AuditEvent[]>`
Queries audit log with filters.

**Parameters**:
```typescript
{
  userId?: string;
  eventType?: AuditEventType;
  startDate?: Date;
  endDate?: Date;
  limit?: number;  // Default: 1000
}
```

**Returns**: Array of audit events (sorted by timestamp descending)

**Example**:
```typescript
const events = await auditService.query({
  userId: 'user123',
  eventType: AuditEventType.TIMESHEET_CREATE,
  startDate: new Date('2024-01-01'),
  limit: 100
});
```

---

##### `getStatistics(options): Promise<Statistics>`
Gets audit statistics.

**Returns**:
```typescript
{
  totalEvents: number;
  eventsByType: Record<string, number>;
  successRate: number;
  failureCount: number;
}
```

---

#### ResilienceService Methods

##### `executeWithFallback<T>(operation, fallback, options): Promise<T>`
Executes operation with fallback on failure.

**Parameters**:
- `operation`: Primary async function
- `fallback`: Fallback function
- `options`:
  ```typescript
  {
    operationName?: string;
    userId?: string;
    enableQueue?: boolean;
    queueData?: any;
  }
  ```

**Example**:
```typescript
const result = await resilienceService.executeWithFallback(
  () => odooService.logTime(entry),
  () => ({ success: false, queued: true }),
  {
    operationName: 'create_timesheet',
    userId: 'user123',
    enableQueue: true,
    queueData: entry
  }
);
```

---

##### `checkOdooAvailability(): Promise<boolean>`
Checks if Odoo is available (with 1-minute cache).

**Returns**: `true` if Odoo is responding

---

##### `getQueueStatus(): QueueStatus`
Gets offline queue status.

**Returns**:
```typescript
{
  size: number;
  enabled: boolean;
  odooAvailable: boolean;
  processing: boolean;
}
```

---

##### `clearQueue(): void`
Clears the offline queue.

---

#### RateLimiter Methods

##### `middleware()`
Returns Express/Restify middleware for rate limiting.

**Example**:
```typescript
server.post('/api/messages',
  createRateLimiter({
    requests: 100,
    windowMs: 60000
  }),
  handler
);
```

---

##### `reset(key): void`
Resets rate limit for a specific key.

---

##### `getInfo(key): RateLimitInfo`
Gets current rate limit info for a key.

**Returns**:
```typescript
{
  limit: number;
  remaining: number;
  reset: Date;
}
```

---

#### Utility Functions

##### `withRetry<T>(fn, options): Promise<T>`
Executes function with retry and exponential backoff.

**Example**:
```typescript
await withRetry(
  () => odooService.logTime(entry),
  {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2
  }
);
```

---

##### `sanitizeString(input, options): string`
Sanitizes string input.

**Options**:
```typescript
{
  maxLength?: number;        // Default: 10000
  allowHTML?: boolean;       // Default: false
  allowSpecialChars?: boolean; // Default: true
}
```

---

##### `sanitizeTimesheetInput(data): SanitizedData`
Comprehensive sanitization for timesheet data.

---

##### `sanitizeSQL(input): string`
Removes SQL injection patterns.

---

---

## Configuration

### Environment Variables

#### Required Variables

| Variable | Description | Example | Validation |
|----------|-------------|---------|------------|
| `BOT_ID` | Microsoft Teams Bot Application ID | `12345678-1234-1234-1234-123456789012` | GUID format |
| `BOT_PASSWORD` | Microsoft Teams Bot Client Secret | `abc123...xyz` | Non-empty string |
| `ODOO_URL` | Odoo instance URL | `https://odoo.company.com` | Valid URL |
| `ODOO_DB` | Odoo database name | `production` | Non-empty string |
| `ODOO_USERNAME` | Odoo username | `api_user` | Non-empty string |
| `ODOO_PASSWORD` | Odoo password | `secure_password` | Non-empty string |
| `GEMINI_API_KEY` | Google Gemini API key | `AIzaSy...` | Starts with "AI", length > 10 |

---

#### Optional Variables

| Variable | Description | Default | Validation |
|----------|-------------|---------|------------|
| `PORT` | HTTP server port | `3978` | 1-65535 |
| `GEMINI_MODEL` | Gemini AI model name | `gemini-3-flash-preview` | Non-empty string |
| `PROJECT_CACHE_TTL` | Project cache TTL (ms) | `3600000` (1 hour) | Positive integer |
| `LOG_LEVEL` | Logging level | `info` | error, warn, info, debug |
| `LOG_FILE` | Log file path | `logs/bot.log` | Valid file path |
| `NODE_ENV` | Environment | `development` | development, production, test |

---

### Configuration Validation

#### Schema-Based Validation

Located in `/Users/imdadismail/Documents/odoo_teams_bot/src/config/configValidation.ts`

**Validation Rules**:
```typescript
{
  BOT_ID: {
    required: true,
    type: 'string'
  },
  PORT: {
    required: false,
    type: 'number',
    validator: (v) => {
      const num = parseInt(v, 10);
      return num > 0 && num < 65536;
    },
    defaultValue: '3978'
  },
  ODOO_URL: {
    required: true,
    type: 'url'
  },
  GEMINI_API_KEY: {
    required: true,
    type: 'string',
    validator: (v) => v.startsWith('AI') && v.length > 10
  },
  LOG_LEVEL: {
    required: false,
    type: 'string',
    validator: (v) => ['error', 'warn', 'info', 'debug'].includes(v),
    defaultValue: 'info'
  }
}
```

**Validation Process**:
1. Load environment variables from `.env`
2. Check required variables are present
3. Validate types and custom validators
4. Apply default values for missing optional variables
5. Log warnings for defaults used
6. Throw error if validation fails

**Usage**:
```typescript
import { configValidator } from './config/configValidation';

const validation = configValidator.validate();
if (!validation.valid) {
  throw new Error(`Configuration validation failed:\n${validation.errors.join('\n')}`);
}
```

---

### .env File Example

```bash
# Bot Configuration
BOT_ID=12345678-1234-1234-1234-123456789012
BOT_PASSWORD=abc123def456ghi789jkl012mno345pqr678
PORT=3978

# Odoo Configuration
ODOO_URL=https://odoo.company.com
ODOO_DB=production
ODOO_USERNAME=api_user
ODOO_PASSWORD=SecurePassword123!

# Gemini AI Configuration
GEMINI_API_KEY=AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234567
GEMINI_MODEL=gemini-3-flash-preview

# Cache Configuration
PROJECT_CACHE_TTL=3600000

# Logging Configuration
LOG_LEVEL=info
LOG_FILE=logs/bot.log

# Environment
NODE_ENV=production
```

---

---

## Security

### Input Sanitization

#### XSS Prevention
Located in `/Users/imdadismail/Documents/odoo_teams_bot/src/utils/sanitization.ts`

**HTML Escaping**:
```typescript
function escapeHTML(input: string): string {
  const htmlEntities = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  };
  return input.replace(/[&<>"'/]/g, (char) => htmlEntities[char]);
}
```

**Applied To**:
- All user messages
- Project names
- Descriptions
- Any string displayed in UI

---

#### SQL Injection Prevention
```typescript
function sanitizeSQL(input: string): string {
  const sqlPatterns = [
    /\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC)\b/gi,
    /(;|--|\/\*|\*\/|@@|@)/g,
    /\s+(OR|AND)\s+/gi,
    /('.*--)/g
  ];

  let sanitized = input;
  for (const pattern of sqlPatterns) {
    sanitized = sanitized.replace(pattern, '');
  }
  return sanitized.trim();
}
```

**Applied To**:
- Descriptions before Odoo API calls
- Any text used in database queries

---

#### Log Injection Prevention
```typescript
function sanitizeLogData(data: any): any {
  if (typeof data === 'string') {
    return data.replace(/[\n\r\t]/g, ' ').trim();
  }
  // ... handle objects
}
```

**Prevents**:
- Log forging
- CRLF injection
- Log splitting attacks

---

### Rate Limiting

#### Per-User Rate Limiting
Located in `/Users/imdadismail/Documents/odoo_teams_bot/src/middleware/rateLimit.ts`

**Implementation**:
- Sliding window algorithm
- Key: User ID (from Teams) or IP address
- Default: 100 requests per minute
- Headers: `X-RateLimit-*` for transparency

**Presets**:
```typescript
AI_OPERATIONS: {
  requests: 30,
  windowMs: 60000  // 1 minute
}

BOT_MESSAGES: {
  requests: 20,
  windowMs: 60000
}

ODOO_OPERATIONS: {
  requests: 50,
  windowMs: 60000
}
```

**Response on Limit Exceeded**:
```json
{
  "error": "Too many requests",
  "message": "Rate limit exceeded. Please try again later.",
  "limit": 100,
  "windowMs": 60000
}
```
HTTP Status: 429
Header: `Retry-After: 60`

---

### Authentication

#### Bot Framework Authentication
Located in `/Users/imdadismail/Documents/odoo_teams_bot/src/index.ts`

**Implementation**:
```typescript
const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
  MicrosoftAppId: config.bot.appId,
  MicrosoftAppPassword: config.bot.appPassword,
  MicrosoftAppType: 'MultiTenant'
});

const botFrameworkAuthentication = createBotFrameworkAuthenticationFromConfiguration(
  null,
  credentialsFactory
);

const adapter = new CloudAdapter(botFrameworkAuthentication);
```

**Security Features**:
- JWT token validation
- Request signing verification
- Timestamp validation (prevents replay attacks)
- Multi-tenant support

---

### Audit Trail

#### Comprehensive Logging
Located in `/Users/imdadismail/Documents/odoo_teams_bot/src/services/audit.ts`

**Events Logged**:
- All timesheet creations
- All API calls
- Authentication failures
- Rate limit violations
- System errors

**Audit Event Structure**:
```typescript
{
  id: "audit_1705318400_abc123",
  timestamp: "2024-01-15T10:30:00.000Z",
  eventType: "timesheet.create",
  userId: "user123",
  action: "Created timesheet entry",
  resource: "timesheet",
  resourceId: "456",
  details: {
    projectId: 123,
    projectName: "Website Redesign",
    hours: 4,
    date: "2024-01-15"
  },
  success: true
}
```

**Storage**:
- JSONL format (one JSON per line)
- File: `logs/audit.jsonl`
- Batch writing (100 events or 10 seconds)
- Automatic archiving support

---

### Error Handling Security

#### Error Message Sanitization
Located in `/Users/imdadismail/Documents/odoo_teams_bot/src/middleware/errorHandler.ts`

**Policy**:
- Never expose stack traces to users
- Never reveal internal paths
- Never expose credentials
- Provide generic error messages

**Implementation**:
```typescript
// Safe error message for users
const userMessage = 'An error occurred. Please try again later.';

// Detailed error logged internally
logger.error('Operation failed', {
  error: error.message,
  stack: error.stack,
  context: { /* ... */ }
});
```

---

---

## Resilience & Reliability

### Error Classification

#### Automatic Error Classification
Located in `/Users/imdadismail/Documents/odoo_teams_bot/src/middleware/errorRecovery.ts`

**Categories**:
```typescript
NETWORK:           // Connection errors, DNS failures
AUTHENTICATION:    // Invalid credentials (401)
AUTHORIZATION:     // Insufficient permissions (403)
VALIDATION:        // Invalid input (400)
RATE_LIMIT:        // Too many requests (429)
SERVICE_UNAVAILABLE: // Maintenance, downtime (503)
TIMEOUT:           // Request timeout
UNKNOWN:           // Unrecognized errors
```

**Classification Logic**:
```typescript
if (errorCode === 'ECONNRESET' || errorMessage.includes('network')) {
  category = ErrorCategory.NETWORK;
  recoverable = true;
  retryable = true;
}

if (errorMessage.includes('authentication') || status === 401) {
  category = ErrorCategory.AUTHENTICATION;
  recoverable = false;  // Requires user intervention
  retryable = false;
}
```

---

### Retry Mechanism

#### Exponential Backoff with Jitter
Located in `/Users/imdadismail/Documents/odoo_teams_bot/src/utils/retry.ts`

**Algorithm**:
```typescript
delay = min(
  initialDelay * (backoffMultiplier ^ attempt) + jitter,
  maxDelay
)

jitter = exponentialDelay * jitterFactor * (random * 2 - 1)
```

**Example Timeline**:
```
Attempt 1: Immediate
Attempt 2: 1000ms + jitter (-100 to +100ms)
Attempt 3: 2000ms + jitter (-200 to +200ms)
Attempt 4: 4000ms + jitter (-400 to +400ms)
Max delay: 30000ms
```

**Presets**:
- `QUICK`: 2 attempts, 500ms initial, 2s max
- `STANDARD`: 3 attempts, 1s initial, 10s max
- `EXTENDED`: 5 attempts, 1s initial, 30s max
- `PATIENT`: 4 attempts, 2s initial, 60s max

---

### Graceful Degradation

#### Offline Queue
Located in `/Users/imdadismail/Documents/odoo_teams_bot/src/services/resilience.ts`

**When Odoo is Unavailable**:
1. Detect connection failure
2. Queue operation to `data/offline-queue.json`
3. Return success message to user
4. Process queue every 30 seconds
5. Retry up to 5 times per operation

**Queue Entry**:
```typescript
{
  id: "queue_1705318400_abc123",
  timestamp: 1705318400000,
  operation: "create_timesheet",
  data: { /* TimesheetEntry */ },
  userId: "user123",
  retryCount: 0
}
```

**Queue Properties**:
- Max size: 1000 operations (FIFO eviction)
- Max retries: 5 per operation
- Processing interval: 30 seconds
- Persistence: JSON file

---

### Health Monitoring

#### Dependency Health Checks
Located in `/Users/imdadismail/Documents/odoo_teams_bot/src/services/health.ts`

**Checks**:
- **Memory**: Usage < 90%
- **CPU**: Load average monitoring
- **Odoo**: API availability and response time
- **Gemini**: API availability

**Periodic Checks**:
- Odoo: Every 30 seconds
- Gemini: Every 2.5 minutes (cost optimization)

**Status Values**:
- `pass`: Check passed
- `warn`: Warning threshold exceeded
- `fail`: Check failed

**Example Check Result**:
```json
{
  "name": "odoo",
  "status": "pass",
  "duration": 234,
  "message": "Odoo API is responding"
}
```

---

---

## Performance

### Caching Strategy

#### Multi-Layer Caching

**Layer 1: Project Cache**
- Implementation: In-memory Map
- TTL: 1 hour (configurable)
- Cleanup: Every 5 minutes
- Size: Unlimited (bounded by project count)

**Benefits**:
- Reduces Odoo API calls by ~99%
- Faster parsing (no project fetch delay)
- Lower latency for users

**Usage**:
```typescript
// First call: Fetches from Odoo
const projects1 = await odooService.getProjects();

// Subsequent calls: Returns cached
const projects2 = await odooService.getProjects();
```

---

**Layer 2: AI Response Cache**
- Implementation: Hash-based Map
- TTL: 2 hours (configurable)
- Max size: 500 entries
- Cache key: SHA-256 hash of normalized input

**Benefits**:
- Reduces Gemini API costs
- Faster response for similar inputs
- Lower latency

**Cache Key Generation**:
```typescript
const normalized = input
  .toLowerCase()
  .trim()
  .replace(/\s+/g, ' ')
  .replace(/[^\w\s]/g, '');

const hash = crypto
  .createHash('sha256')
  .update(normalized)
  .digest('hex')
  .substring(0, 16);
```

**Statistics**:
```typescript
{
  size: 42,
  hits: 156,
  misses: 44,
  hitRate: 0.78  // 78% cache hit rate
}
```

---

### Response Optimization

#### Typing Indicators
```typescript
await context.sendActivity({ type: 'typing' });
```

Shows user that bot is processing, improving perceived performance.

---

#### Async Operations
All operations are non-blocking:
```typescript
// Bad: Blocking
const projects = this.fetchProjects();
const parsed = this.parseText();

// Good: Non-blocking
const projects = await this.fetchProjects();
const parsed = await this.parseText();
```

---

#### Lazy Loading
```typescript
// Only load health service when needed
if (req.path() === '/health') {
  const { healthService } = await import('./services/health');
  return healthService.getHealth();
}
```

---

### Performance Metrics

#### Target Metrics
- **Health Check**: < 50ms
- **Project Fetch (cached)**: < 5ms
- **Project Fetch (uncached)**: < 500ms
- **AI Parsing (cached)**: < 10ms
- **AI Parsing (uncached)**: < 2000ms
- **Timesheet Creation**: < 1000ms

#### Monitoring
Prometheus metrics available at `/metrics`:
- Response times
- Cache hit rates
- Error rates
- Queue sizes

---

---

## Deployment

### Local Development

#### Prerequisites
- Node.js v20+
- npm or yarn
- Git

#### Setup
```bash
# Clone repository
git clone <repository-url>
cd odoo_teams_bot

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your credentials
nano .env

# Build TypeScript
npm run build

# Run in development
npm run dev
```

#### Development Commands
```bash
npm run dev        # Development mode with ts-node
npm run watch      # Watch mode (auto-rebuild)
npm run lint       # Run ESLint
npm test           # Run tests
npm run test:watch # Run tests in watch mode
```

---

### Docker Deployment

#### Dockerfile Analysis
Located at `/Users/imdadismail/Documents/odoo_teams_bot/Dockerfile`

**Multi-Stage Build**:
```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
USER nodejs
EXPOSE 3978
CMD ["node", "dist/index.js"]
```

**Benefits**:
- Smaller image size (no dev dependencies)
- Non-root user (security)
- Health checks built-in
- Optimized layers

---

#### Docker Compose
Located at `/Users/imdadismail/Documents/odoo_teams_bot/docker-compose.yml`

**Services**:
```yaml
services:
  odoo-teams-bot:
    build: .
    container_name: odoo-teams-bot
    restart: unless-stopped
    ports:
      - "3978:3978"
    env_file:
      - .env
    environment:
      - NODE_ENV=production
    volumes:
      - ./logs:/app/logs
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3978/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 40s
```

**Commands**:
```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f odoo-teams-bot

# Restart
docker-compose restart

# Stop
docker-compose down

# Rebuild
docker-compose down
docker-compose build
docker-compose up -d
```

---

### Production Deployment

#### CI/CD Pipeline
Located at `/Users/imdadismail/Documents/odoo_teams_bot/.github/workflows/ci.yml`

**Stages**:

1. **Lint**
   - Runs ESLint
   - Validates code style

2. **Test**
   - Runs Jest tests
   - Uploads coverage to Codecov

3. **Build**
   - Compiles TypeScript
   - Uploads build artifacts

4. **Security Scan**
   - npm audit
   - Snyk security scan

5. **Docker Build**
   - Builds Docker image
   - Pushes to GitHub Container Registry
   - Only on main branch

6. **Deploy**
   - Deploys to production
   - Only on main branch
   - Manual approval (environment: production)

**Triggers**:
- Push to main/develop
- Pull requests to main/develop

---

#### Environment Configuration

**Production .env**:
```bash
NODE_ENV=production
LOG_LEVEL=info
PORT=3978

# Use strong, randomly generated passwords
BOT_PASSWORD=<generate from Azure Portal>
ODOO_PASSWORD=<use strong password>
GEMINI_API_KEY=<from Google Cloud Console>
```

**Security Best Practices**:
1. Never commit `.env` file
2. Use secrets management (Azure Key Vault, AWS Secrets Manager)
3. Rotate credentials regularly
4. Use read-only Odoo user when possible
5. Enable HTTPS only
6. Configure firewall rules

---

#### Monitoring

**Health Endpoint**:
```bash
curl http://localhost:3978/health
```

**Metrics Endpoint** (Prometheus):
```bash
curl http://localhost:3978/metrics
```

**Log Files**:
```bash
# View all logs
tail -f logs/bot.log

# View errors only
tail -f logs/error.log

# View audit log
tail -f logs/audit.jsonl
```

**Docker Logs**:
```bash
docker-compose logs -f odoo-teams-bot
```

---

#### Scaling

**Horizontal Scaling**:
- Use load balancer (nginx, HAProxy)
- Deploy multiple instances
- Shared cache (Redis) recommended for production

**Vertical Scaling**:
- Increase Node.js memory: `NODE_OPTIONS=--max-old-space-size=4096`
- Use larger Docker instance

**Database Connection Pooling**:
- Not applicable (stateless XML-RPC)

---

---

## Testing

### Test Structure

```
test/
├── setup.ts                    # Test configuration
├── middleware/
│   ├── errorRecovery.test.ts
│   ├── rateLimit.test.ts
│   └── errorHandler.test.ts
├── services/
│   ├── odoo.test.ts
│   ├── parser.test.ts
│   ├── cache.test.ts
│   └── audit.test.ts
├── cards/
│   └── timesheetCard.test.ts
└── utils/
    ├── retry.test.ts
    ├── sanitization.test.ts
    ├── formatting.test.ts
    └── validation.test.ts
```

---

### Jest Configuration

Located at `/Users/imdadismail/Documents/odoo_teams_bot/jest.config.js`

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/types/**/*.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testTimeout: 10000,
  verbose: true,
};
```

---

### Running Tests

```bash
# Run all tests
npm test

# Run in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- sanitization.test.ts

# Run tests matching pattern
npm test -- --testNamePattern="sanitize"
```

---

### Writing Tests

#### Example Test
```typescript
describe('sanitizeString', () => {
  it('should remove HTML tags', () => {
    const input = '<script>alert("xss")</script>Hello';
    const result = sanitizeString(input);
    expect(result).not.toContain('<script>');
  });

  it('should truncate long strings', () => {
    const input = 'a'.repeat(20000);
    const result = sanitizeString(input, { maxLength: 1000 });
    expect(result.length).toBe(1000);
  });

  it('should escape HTML entities', () => {
    const input = '<div>&nbsp;</div>';
    const result = sanitizeString(input);
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
  });
});
```

---

#### Mocking External Services
```typescript
import { odooService } from '../src/services/odoo';

jest.mock('../src/services/odoo', () => ({
  odooService: {
    getProjects: jest.fn().mockResolvedValue([
      { id: 1, name: 'Project A', active: true }
    ]),
    logTime: jest.fn().mockResolvedValue(123)
  }
}));

describe('TimesheetBot', () => {
  it('should fetch projects from Odoo', async () => {
    const projects = await odooService.getProjects();
    expect(projects).toHaveLength(1);
    expect(odooService.getProjects).toHaveBeenCalled();
  });
});
```

---

### Test Coverage

**Current Thresholds**:
- Branches: 70%
- Functions: 70%
- Lines: 70%
- Statements: 70%

**View Coverage Report**:
```bash
npm run test:coverage
open coverage/lcov-report/index.html
```

---

---

## Troubleshooting

### Common Issues

#### Bot Doesn't Respond

**Symptoms**:
- Messages sent to bot with no response
- Health endpoint returns 200 OK

**Diagnosis**:
```bash
# Check bot is running
curl http://localhost:3978/health

# Check logs
tail -f logs/bot.log

# Check for authentication errors
grep "authentication" logs/error.log
```

**Solutions**:
1. Verify `BOT_ID` and `BOT_PASSWORD` are correct
2. Check Bot Framework registration in Azure Portal
3. Verify bot endpoint is reachable from internet
4. Check firewall allows inbound traffic on port 3978
5. Validate bot is configured in Teams Admin Center

---

#### Parsing Fails

**Symptoms**:
- Bot responds with "Unable to Parse Timesheet"
- Error card displayed

**Diagnosis**:
```bash
# Check Gemini API key
echo $GEMINI_API_KEY

# Check for API errors
grep "Gemini" logs/error.log

# Test API directly
curl -H "Content-Type: application/json" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -d '{"contents":[{"parts":[{"text":"test"}]}]}' \
  https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent
```

**Solutions**:
1. Verify `GEMINI_API_KEY` is valid
2. Check Gemini API quota limits
3. Ensure network allows access to `generativelanguage.googleapis.com`
4. Try simpler message format
5. Check if project exists in Odoo

---

#### Odoo Connection Fails

**Symptoms**:
- "Unable to fetch projects from Odoo"
- Connection timeout errors

**Diagnosis**:
```bash
# Test Odoo connectivity
curl -I $ODOO_URL

# Test XML-RPC endpoint
curl -X POST $ODOO_URL/xmlrpc/2/common \
  -H "Content-Type: text/xml" \
  -d '<?xml version="1.0"?><methodCall><methodName>version</methodName></methodCall>'

# Check logs
grep "Odoo" logs/error.log
```

**Solutions**:
1. Verify `ODOO_URL` is correct and accessible
2. Test credentials via Odoo web interface
3. Ensure XML-RPC is enabled in Odoo
4. Check firewall allows outbound traffic to Odoo
5. Verify user has required permissions
6. Check Odoo server logs for errors

---

#### Project Not Found

**Symptoms**:
- Bot can't match project name
- "Could not identify the project" error

**Diagnosis**:
```bash
# Check cached projects
grep "Projects fetched" logs/bot.log

# Clear cache by restarting
docker-compose restart
```

**Solutions**:
1. Ensure project is active in Odoo (`active = True`)
2. Use exact project name or code
3. Clear cache and restart bot
4. Check user has access to project in Odoo
5. Verify project visibility settings

---

#### High Memory Usage

**Symptoms**:
- Container getting OOM killed
- Slow response times

**Diagnosis**:
```bash
# Check memory usage
docker stats odoo-teams-bot

# Check memory in logs
grep "Memory" logs/bot.log
```

**Solutions**:
1. Reduce `PROJECT_CACHE_TTL`
2. Reduce AI cache size
3. Increase container memory limit
4. Restart bot periodically
5. Check for memory leaks (profile with clinic)

---

#### Docker Container Won't Start

**Symptoms**:
- Container exits immediately
- `docker-compose up` fails

**Diagnosis**:
```bash
# Check container logs
docker-compose logs odoo-teams-bot

# Check for port conflicts
lsof -i :3978

# Validate configuration
npm run validate
```

**Solutions**:
1. Fix environment variables in `.env`
2. Release port 3978 if in use
3. Build image: `docker-compose build`
4. Check file permissions on `logs/` directory
5. Validate Node.js version (v20+)

---

### Debug Mode

**Enable Debug Logging**:
```bash
# Edit .env
LOG_LEVEL=debug

# Restart
docker-compose restart
```

**Verbose Logs**:
```bash
# All logs
tail -f logs/bot.log

# Errors only
tail -f logs/error.log

# Audit trail
tail -f logs/audit.jsonl | jq '.'
```

---

### Health Check Commands

```bash
# Basic health
curl http://localhost:3978/health

# Detailed health
curl http://localhost:3978/health/detailed | jq '.'

# Prometheus metrics
curl http://localhost:3978/metrics
```

---

### Log Analysis

**Find errors in last hour**:
```bash
grep "$(date -u +'%Y-%m-%d %H')" logs/error.log
```

**Count errors by type**:
```bash
grep '"errorMessage"' logs/audit.jsonl | \
  jq -r '.details.error' | \
  sort | uniq -c | sort -rn
```

**View failed timesheets**:
```bash
grep '"eventType":"timesheet.create"' logs/audit.jsonl | \
  jq 'select(.success == false)'
```

---

---

## Development Guide

### Code Style

**TypeScript Configuration**:
- Strict mode enabled
- No implicit any
- Strict null checks
- No unused locals/parameters

**Formatting** (recommended):
- Use Prettier for consistent formatting
- 2 space indentation
- Single quotes for strings
- Semicolons required

**Naming Conventions**:
- Classes: PascalCase (`TimesheetBot`)
- Functions/Methods: camelCase (`getProjects`)
- Constants: UPPER_SNAKE_CASE (`MAX_RETRIES`)
- Private members: prefix with underscore (`_cache`)

---

### Adding New Features

#### 1. Create Service
```typescript
// src/services/myService.ts
export class MyService {
  private config: MyConfig;

  constructor(config: MyConfig) {
    this.config = config;
  }

  async myMethod(): Promise<Result> {
    // Implementation
  }
}

export const myService = new MyService(config.myConfig);
```

#### 2. Add Tests
```typescript
// test/services/myService.test.ts
import { myService } from '../src/services/myService';

describe('MyService', () => {
  it('should do something', async () => {
    const result = await myService.myMethod();
    expect(result).toBeDefined();
  });
});
```

#### 3. Update Types
```typescript
// src/types/myService.types.ts
export interface MyConfig {
  setting: string;
}

export interface Result {
  success: boolean;
  data?: any;
}
```

#### 4. Add to Config
```typescript
// src/config/config.ts
export const config: Config = {
  // ... existing config
  myConfig: {
    setting: process.env.MY_SETTING || 'default'
  }
};
```

---

### Git Workflow

**Branch Naming**:
- `feature/feature-name`
- `bugfix/bug-description`
- `hotfix/critical-fix`

**Commit Messages**:
```
feat: add new feature
fix: resolve bug in parser
docs: update README
test: add unit tests for service
refactor: improve code structure
```

**Pull Request Process**:
1. Create feature branch
2. Make changes with tests
3. Ensure tests pass
4. Create PR to develop
5. Code review
6. Merge after approval

---

### Contributing Guidelines

1. **Code Quality**:
   - All tests must pass
   - Coverage maintained above 70%
   - No linting errors
   - TypeScript strict mode compliance

2. **Documentation**:
   - Update README for user-facing changes
   - Add JSDoc comments for public APIs
   - Update type definitions

3. **Testing**:
   - Unit tests for all new functions
   - Integration tests for services
   - Mock external dependencies

4. **Security**:
   - Sanitize all user input
   - Never log sensitive data
   - Follow OWASP guidelines

---

### Performance Optimization

**Profiling**:
```bash
# Node.js profiler
node --prof dist/index.js

# Clinic.js
npm install -g clinic
clinic doctor -- npm start

# Flame graphs
clinic flame -- npm start
```

**Common Optimizations**:
1. Use caching for expensive operations
2. Implement pagination for large datasets
3. Use connection pooling
4. Optimize database queries
5. Enable gzip compression

---

### Resources

**Official Documentation**:
- [Microsoft Bot Framework](https://docs.microsoft.com/en-us/azure/bot-service/)
- [Google Gemini AI](https://ai.google.dev/docs)
- [Odoo XML-RPC API](https://www.odoo.com/documentation/15.0/developer/api/external_api.html)
- [Adaptive Cards](https://adaptivecards.io/)

**Community**:
- [Bot Framework Discord](https://discord.gg/botframework)
- [Stack Overflow](https://stackoverflow.com/questions/tagged/botframework)

---

## Appendix

### Type Definitions

#### Core Types
```typescript
// src/types/index.ts
export interface TimesheetEntry {
  project_id: number;
  project_name: string;
  hours: number;
  date: string;
  description: string;
  user_id?: number;
}

export interface ParsedTimesheetData {
  project_id: number | null;
  project_name: string | null;
  hours: number | null;
  date: string | null;
  description: string;
  confidence: number;
  error?: string;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}
```

#### Bot Types
```typescript
// src/types/bot.types.ts
export interface AdaptiveCardAction {
  type: string;
  verb: string;
  data: TimesheetCardData;
}

export interface TimesheetCardData {
  project_id: number;
  project_name: string;
  hours: number;
  date: string;
  description: string;
}

export interface BotError extends Error {
  code?: string;
  context?: any;
  recoverable?: boolean;
}
```

#### Odoo Types
```typescript
// src/types/odoo.types.ts
export interface OdooConfig {
  url: string;
  db: string;
  username: string;
  password: string;
}

export interface OdooProject {
  id: number;
  name: string;
  code?: string;
  active: boolean;
}
```

---

### Quick Reference

**File Locations**:
- Main entry: `/Users/imdadismail/Documents/odoo_teams_bot/src/index.ts`
- Bot logic: `/Users/imdadismail/Documents/odoo_teams_bot/src/bot.ts`
- Odoo service: `/Users/imdadismail/Documents/odoo_teams_bot/src/services/odoo.ts`
- Parser service: `/Users/imdadismail/Documents/odoo_teams_bot/src/services/parser.ts`
- Config: `/Users/imdadismail/Documents/odoo_teams_bot/src/config/config.ts`
- Types: `/Users/imdadismail/Documents/odoo_teams_bot/src/types/`

**Common Commands**:
```bash
npm run build          # Compile TypeScript
npm start              # Production server
npm run dev            # Development server
npm test               # Run tests
npm run lint           # Lint code
npm run validate       # Validate config
```

**Ports**:
- Bot server: 3978 (configurable via `PORT`)
- Health endpoint: `/health`
- Metrics endpoint: `/metrics`

**Log Files**:
- Main log: `logs/bot.log`
- Error log: `logs/error.log`
- Audit log: `logs/audit.jsonl`
- Exceptions: `logs/exceptions.log`

---

### Support

**For Issues**:
1. Check troubleshooting section
2. Review logs for errors
3. Validate configuration
4. Check service health

**For Contributions**:
1. Fork repository
2. Create feature branch
3. Make changes with tests
4. Submit pull request

**Contact**:
- GitHub Issues: [repository-url]/issues
- Documentation: See README.md

---

**Document Version**: 1.0.0
**Last Updated**: 2024-01-15
**Maintained By**: Development Team
