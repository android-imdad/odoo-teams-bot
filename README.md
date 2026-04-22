# Odoo Teams Bot - Timesheet Management

A Microsoft Teams bot that uses AI to parse natural language timesheet entries and automatically log them to Odoo.

## Features

- **Natural Language Processing**: Uses Google Gemini AI to understand timesheet entries in plain English
- **Interactive Confirmation**: Adaptive Cards provide visual confirmation before saving
- **Automatic Project & Task Matching**: Intelligently matches project names and task names from your Odoo instance using fuzzy search
- **Smart Task Filtering**: Fuse.js filters thousands of tasks to the top 5 matches before AI parsing - reduces token usage by 99%+
- **Billability Support**: Set per-user default billability preferences; supports both standard `billable` field and custom `x_is_billable` boolean field
- **Flexible Input**: Supports various date and hour formats
- **Comprehensive Logging**: Advanced Winston-based logging with file rotation
- **Docker Ready**: Containerized deployment for easy setup and scaling
- **Multiple Authentication Modes**: Support for API Key, OAuth, Service Account, and Admin Proxy modes
- **Security Hardened**: STRIDE threat model remediation including rate limiting, PKCE for OAuth, HMAC-signed management routes, and audit trail integrity

## Prerequisites

- Node.js v20 or higher
- Docker and Docker Compose (for containerized deployment)
- Microsoft Teams Bot registration (Bot ID and Password)
- Odoo instance (versions 13-18) with XML-RPC enabled
- Google Gemini API key

## Installation

### 1. Clone the repository

```bash
cd odoo_teams_bot
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your actual values:

```env
BOT_ID=your-bot-id
BOT_PASSWORD=your-bot-password
ODOO_URL=https://your-odoo.com
ODOO_DB=your-database
AUTH_MODE=admin_proxy
ODOO_USERNAME=admin@yourcompany.com
ODOO_PASSWORD=your-admin-password
GEMINI_API_KEY=your-gemini-key
```

### 4. Build the application

```bash
npm run build
```

### 5. Run locally

**Production mode:**
```bash
npm start
```

**Development mode (with auto-reload):**
```bash
npm run dev
```

## Docker Deployment

### Build and run with Docker Compose

```bash
docker-compose up -d
```

### View logs

```bash
docker-compose logs -f odoo-teams-bot
```

### Stop the bot

```bash
docker-compose down
```

### Rebuild after changes

```bash
docker-compose down
docker-compose build
docker-compose up -d
```

## Usage

### Basic Timesheet Entry

Simply message the bot in Teams with natural language:

```
I spent 4 hours on project SSI fixing the payment gateway
```

The bot will:
1. Parse your message using Gemini AI
2. Show a confirmation card with extracted details
3. Wait for you to click "Confirm"
4. Create the timesheet entry in Odoo

### Supported Formats

**Hours:**
- "4 hours"
- "4h"
- "4.5 hours"
- "2.25h"

**Dates:**
- "today" (default if not specified)
- "yesterday"
- "last Friday"
- "2024-12-25"
- "December 25th"

**Billability:**
- "billable" or "non-billable" (or "not billable")
- If not specified, uses your per-user default preference
- Falls back to Odoo's project/task default if no preference set

**Projects:**
- Match by name: "project SSI"
- Match by code: "SSI" (if project has code in Odoo)
- Fuzzy matching: "SSi" or "ssi" will still work

### Example Messages

```
Spent 8 hours yesterday on Website Redesign project implementing the new homepage
```

```
4h on SSI debugging the authentication issue
```

```
I worked 6.5 hours on project Mobile App today fixing bugs
```

## Architecture

```
src/
├── index.ts                  # Entry point & HTTP server
├── bot.ts                    # Main bot logic
├── config/
│   ├── config.ts             # Configuration management
│   ├── configValidation.ts   # Schema-based config validation
│   └── logger.ts             # Winston logging setup
├── services/
│   ├── odoo.ts               # Odoo XML-RPC integration
│   ├── parser.ts             # Gemini AI parsing
│   ├── cache.ts              # In-memory caching (LRU with size limits)
│   ├── taskFilter.ts         # Fuse.js fuzzy task filtering
│   ├── billabilityPreference.ts # Per-user billability defaults
│   ├── userMapping.ts        # Teams email → Odoo user ID mapping
│   ├── audit.ts              # Audit trail with hash chain integrity
│   ├── health.ts             # Health checks & Prometheus metrics
│   └── resilience.ts         # Offline queue with HMAC integrity
├── cards/
│   └── timesheetCard.ts      # Adaptive Card generators
├── middleware/
│   ├── errorHandler.ts       # Error handling utilities
│   ├── errorRecovery.ts      # Error classification & recovery
│   └── rateLimit.ts          # Per-user rate limiting
├── routes/
│   └── oauth.ts              # OAuth callback routes
├── types/                    # TypeScript type definitions
│   ├── index.ts
│   ├── odoo.types.ts
│   ├── bot.types.ts
│   └── oauth.types.ts
└── utils/                     # Utility functions
    ├── validation.ts
    ├── formatting.ts
    ├── sanitization.ts       # XSS/SQL injection prevention
    └── retry.ts              # Exponential backoff retry
```

## Technical Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           ODOO TEAMS BOT - TECHNICAL FLOW                       │
└─────────────────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐
    │  MS Teams    │
    │    User      │
    └──────┬───────┘
           │
           │ 1. Send natural language message
           │    "4 hours on SSI project fixing bugs"
           ▼
    ┌─────────────────────────────────────┐
    │       Restify HTTP Server           │
    │  ┌─────────────────────────────┐    │
    │  │   POST /api/messages        │    │
    │  │   BotFrameworkAdapter       │    │
    │  └──────────────┬──────────────┘    │
    └─────────────────┼───────────────────┘
                      │
                      ▼
    ┌─────────────────────────────────────┐
    │         TimesheetBot                │
    │     ┌───────────────────┐           │
    │     │   onMessage()     │           │
    │     └─────────┬─────────┘           │
    └───────────────┼─────────────────────┘
                    │
                    ▼
    ┌────────────────────────────────────────────────────────────────────┐
    │                     MESSAGE PROCESSING FLOW                        │
    │                                                                    │
    │   ┌──────────────────┐                                           │
    │   │ Is this an       │ NO                                        │
    │   │ action submit?   ├───────────────────────────────┐           │
    │   │ (Confirm/Cancel) │                               │           │
    │   └────────┬─────────┘                               │           │
    │            │ YES                                     │           │
    │            ▼                                         │           │
    │   ┌──────────────────┐   ┌──────────────────┐       │           │
    │   │ action: save_    │   │ action: cancel_  │       │           │
    │   │   timesheet      │   │   timesheet      │       │           │
    │   └────────┬─────────┘   └────────┬─────────┘       │           │
    │            │                      │                 │           │
    │            ▼                      ▼                 │           │
    │   ┌──────────────────┐   ┌──────────────────┐       │           │
    │   │ Save to Odoo     │   │ Update card to   │       │           │
    │   │ via XML-RPC      │   │ cancelled state  │       │           │
    │   └────────┬─────────┘   └────────┬─────────┘       │           │
    │            │                      │                 │           │
    │            ▼                      ▼                 │           │
    │   ┌──────────────────┐   ┌──────────────────┐       │           │
    │   │ Update card to   │   │  Return to user  │◄──────┘           │
    │   │ confirmed state  │   └──────────────────┘                   │
    │   └────────┬─────────┘                                           │
    │            │                                                     │
    │            └──────────────────┐                                  │
    │                               ▼                                  │
    │                      ┌──────────────────┐                        │
    │                      │  Return to user  │                        │
    │                      └──────────────────┘                        │
    └────────────────────────────────────────────────────────────────────┘

           │
           │ NATURAL LANGUAGE PROCESSING (for new messages)
           ▼
    ┌────────────────────────────────────────────────────────────────────┐
    │                      STEP 2: GET PROJECTS                          │
    │                                                                    │
    │    ┌────────────────┐                                             │
    │    │ OdooService    │                                             │
    │    │ getProjects()  │                                             │
    │    └───────┬────────┘                                             │
    │            │                                                       │
    │            ▼                                                       │
    │    ┌────────────────────────────┐                                  │
    │    │    Check In-Memory Cache   │◄──────┐                         │
    │    │    (TTL: 1 hour)           │       │                         │
    │    └───────┬────────────────────┘       │                         │
    │            │ Cache Hit                  │ Cache Expired           │
    │            │ NO                         │                         │
    │            ▼                            │                         │
    │    ┌────────────────────────────┐       │                         │
    │    │ Odoo XML-RPC API Call      │       │                         │
    │    │ /xmlrpc/2/object           │       │                         │
    │    │ execute_kw: search & read  │       │                         │
    │    │ model: project.project     │       │                         │
    │    └───────┬────────────────────┘       │                         │
    │            │                            │                         │
    │            ▼                            │                         │
    │    ┌────────────────────────────┐       │                         │
    │    │ Store in Cache             │───────┘                         │
    │    └───────┬────────────────────┘                                   │
    │            │                                                       │
    │            ▼                                                       │
    │    ┌────────────────────────────┐                                  │
    │    │ Return Project List        │                                  │
    │    └────────┬───────────────────┘                                  │
    └─────────────┼──────────────────────────────────────────────────────┘
                  │
                  ▼
    ┌────────────────────────────────────────────────────────────────────┐
    │                   STEP 2b: FILTER TASKS (Optional)                 │
    │                                                                    │
    │    ┌─────────────────────────────────────────────────────┐         │
    │    │  If project identified:                             │         │
    │    │  ┌───────────────────────────────────────────────┐  │         │
    │    │  │ 1. Fetch all tasks from Odoo                  │  │         │
    │    │  │ 2. Filter with Fuse.js fuzzy search           │  │         │
    │    │  │ 3. Return top 5 most relevant tasks           │  │         │
    │    │  └───────────────────────────────────────────────┘  │         │
    │    └──────────┬──────────────────────────────────────────┘         │
    │               │                                                    │
    │               ▼                                                    │
    │    ┌─────────────────────────────────────────────────────┐         │
    │    │  10,000 tasks → Top 5 matches                       │         │
    │    │  "homepage bug" matches "Homepage Redesign"         │         │
    │    │  Reduces AI tokens by 99%+                          │         │
    │    └──────────┬──────────────────────────────────────────┘         │
    └───────────────┼────────────────────────────────────────────────────┘
                    │
                    ▼
    ┌────────────────────────────────────────────────────────────────────┐
    │                    STEP 3: PARSE WITH GEMINI AI                    │
    │                                                                    │
    │    ┌─────────────────────┐                                         │
    │    │  ParserService      │                                         │
    │    │  parseText()        │                                         │
    │    └──────────┬──────────┘                                         │
    │               │                                                    │
    │               ▼                                                    │
    │    ┌─────────────────────────────────────────────────┐             │
    │    │           Build AI Prompt                       │             │
    │    │  ┌─────────────────────────────────────────┐    │             │
    │    │  │ - User text                             │    │             │
    │    │  │ - Available projects (id, name, code)   │    │             │
    │    │  │ - Filtered tasks (top 5 matches)        │    │             │
    │    │  │ - Today's date                          │    │             │
    │    │  │ - Instructions for extraction           │    │             │
    │    │  └─────────────────────────────────────────┘    │             │
    │    └──────────┬──────────────────────────────────────┘             │
    │               │                                                    │
    │               ▼                                                    │
    │    ┌─────────────────────┐                                         │
    │    │ Google Gemini API   │                                         │
    │    │ generateContent()   │                                         │
    │    └──────────┬──────────┘                                         │
    │               │                                                    │
    │               ▼                                                    │
    │    ┌─────────────────────────────────────────────────┐             │
    │    │        AI Response (JSON)                       │             │
    │    │  {                                              │             │
    │    │    "project_id": 42,                            │             │
    │    │    "project_name": "SSI",                       │             │
    │    │    "hours": 4.0,                                │             │
    │    │    "date": "2024-01-15",                        │             │
    │    │    "description": "fixing bugs",                │             │
    │    │    "confidence": 0.95                           │             │
    │    │  }                                              │             │
    │    └──────────┬──────────────────────────────────────┘             │
    │               │                                                    │
    │               ▼                                                    │
    │    ┌─────────────────────┐                                         │
    │    │ Validate & Sanitize │                                         │
    │    │ - Check date format │                                         │
    │    │ - Validate hours > 0│                                         │
    │    │ - Ensure project_id │                                         │
    │    └──────────┬──────────┘                                         │
    └───────────────┼────────────────────────────────────────────────────┘
                    │
                    ▼
    ┌────────────────────────────────────────────────────────────────────┐
    │                    STEP 4: GENERATE CONFIRMATION                   │
    │                                                                    │
    │    ┌─────────────────────────────┐                                 │
    │    │ TimesheetCardGenerator      │                                 │
    │    │ createConfirmationCard()    │                                 │
    │    └───────────┬─────────────────┘                                 │
    │                │                                                    │
    │                ▼                                                    │
    │    ┌────────────────────────────────────────────────────────────┐  │
    │    │                  Adaptive Card                             │  │
    │    │  ┌──────────────────────────────────────────────────────┐  │  │
    │    │  │  Timesheet Entry                                     │  │  │
    │    │  │                                                      │  │  │
    │    │  │  Project:  SSI                                       │  │  │
    │    │  │  Hours:    4 hours                                   │  │  │
    │    │  │  Date:     Monday, January 15, 2024                  │  │  │
    │    │  │  Description: fixing bugs                            │  │  │
    │    │  │                                                      │  │  │
    │    │  │  [  Confirm  ]  [  Cancel  ]                         │  │  │
    │    │  └──────────────────────────────────────────────────────┘  │  │
    │    └───────────┬────────────────────────────────────────────────┘  │
    └───────────────┼─────────────────────────────────────────────────────┘
                    │
                    ▼
    ┌───────────────┴─────────────────────────────────────────────────────┐
    │                          STEP 5: USER ACTION                        │
    │                                                                     │
    │   User clicks Confirm ──────┐                                       │
    │                             ▼                                       │
    │   ┌───────────────────────────────────────────────┐                 │
    │   │  Save to Odoo                                 │                 │
    │   │  - XML-RPC: account.analytic.line.create      │                 │
    │   │  - project_id, hours, date, description       │                 │
    │   └───────────────┬───────────────────────────────┘                 │
    │                   │                                                 │
    │                   ▼                                                 │
    │   ┌───────────────────────────────────────────────┐                 │
    │   │  Update card (remove buttons)                 │                 │
    │   │  Show "Timesheet Saved ✓"                     │                 │
    │   └───────────────────────────────────────────────┘                 │
    │                                                                     │
    │   User clicks Cancel ───────┐                                       │
    │                             ▼                                       │
    │   ┌───────────────────────────────────────────────┐                 │
    │   │  Update card (remove buttons)                 │                 │
    │   │  Show "Timesheet Cancelled ✗"                 │                 │
    │   └───────────────────────────────────────────────┘                 │
    └─────────────────────────────────────────────────────────────────────┘

    ┌─────────────────────────────────────────────────────────────────────┐
    │                            ERROR HANDLING PATHS                     │
    │                                                                     │
    │   Parsing Failed:         Odoo Unavailable:       Save Failed:      │
    │   ┌───────────────┐       ┌───────────────┐       ┌───────────────┐ │
    │   │ Show Error    │       │ Show Error    │       │ Show Error    │ │
    │   │ Card with     │       │ Card with     │       │ Card with     │ │
    │   │ suggestions   │       │ retry option  │       │ admin contact │ │
    │   └───────────────┘       └───────────────┘       └───────────────┘ │
    │                                                                     │
    └─────────────────────────────────────────────────────────────────────┘

    ┌─────────────────────────────────────────────────────────────────────┐
    │                              HEALTH CHECK                           │
    │                                                                     │
    │   GET /health                                                       │
    │   {                                                                 │
    │     "status": "healthy",                                            │
    │     "timestamp": "2024-01-15T10:30:00.000Z",                        │
    │     "uptime": 3600000                                               │
    │   }                                                                 │
    │                                                                     │
    └─────────────────────────────────────────────────────────────────────┘
```

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| BOT_ID | Microsoft Bot ID | Yes | - |
| BOT_PASSWORD | Microsoft Bot Password | Yes (unless using Managed Identity) | - |
| BOT_TENANT_ID | Azure Tenant ID for single-tenant bots | No | - |
| AZURE_USE_MANAGED_IDENTITY | Use Azure Managed Identity | No | false |
| AZURE_CLIENT_ID | Managed Identity Client ID | For User-Assigned MI| - |
| AZURE_TENANT_ID | Azure Tenant ID | No | - |
| PORT | HTTP server port | No | 3978 |
| ODOO_URL | Odoo instance URL | Yes | - |
| ODOO_DB | Odoo database name | Yes | - |
| ODOO_USERNAME | Odoo admin username | For admin_proxy/service_account | - |
| ODOO_PASSWORD | Odoo admin password | For admin_proxy/service_account | - |
| AUTH_MODE | Authentication mode | No | api_key |
| GEMINI_API_KEY | Google Gemini API key | Yes | - |
| GEMINI_MODEL | Gemini model name | No | gemini-3.1-flash-lite-preview |
| PROJECT_CACHE_TTL | Project cache duration (ms) | No | 3600000 (1 hour) |
| LOG_LEVEL | Logging level | No | info |
| LOG_FILE | Log file path | No | logs/bot.log |
| NODE_ENV | Environment | No | development |

### Azure Managed Identity (Recommended for Production)

**User-Assigned Managed Identity** eliminates the need to manage client secrets for your Azure Bot.

#### Benefits:
- ✅ No secrets to manage or rotate
- ✅ Azure handles authentication automatically
- ✅ More secure than client secrets
- ✅ Works seamlessly with Azure App Service

#### Setup Steps:

1. **Create Azure Bot in Azure Portal**
   - Go to Azure Portal → Create "Azure Bot"
   - Select "User-assigned managed identity" as the app type
   - Note the **Microsoft App ID** (this is your `BOT_ID`)

2. **Create Managed Identity**
   - Go to Azure Portal → Create "User-Assigned Managed Identity"
   - Copy the **Client ID** (this is your `AZURE_CLIENT_ID`)

3. **Configure `.env`**
   ```bash
   AZURE_USE_MANAGED_IDENTITY=true
   BOT_ID=<from Azure Bot - Microsoft App ID>
   AZURE_CLIENT_ID=<from Managed Identity>
   # BOT_PASSWORD is not needed!
   ```

4. **Deploy to Azure App Service**
   - Assign the managed identity to your App Service
   - The bot will automatically authenticate using Azure AD

#### For Local Development:

Set `AZURE_USE_MANAGED_IDENTITY=false` and use traditional authentication:
```bash
BOT_ID=your-bot-id
BOT_PASSWORD=your-client-secret
```

Or use Azure CLI for local authentication:
```bash
az login
```

The `DefaultAzureCredential` will automatically use your Azure CLI credentials.

### Authentication Modes

The bot supports four authentication modes, configurable via `AUTH_MODE`:

#### 1. Admin Proxy Mode (`AUTH_MODE=admin_proxy`) - RECOMMENDED

Best for enterprise environments where IT manages Odoo access centrally.

- Uses a single admin service account to authenticate with Odoo
- When a user sends a timesheet entry, the bot extracts their email from Teams
- The bot looks up the user's Odoo account by matching the email in `res.users`
- Timesheets are logged using the admin account but attributed to the matched user
- Users can set a **default billability preference** (billable/non-billable) that persists across sessions

**Setup:**
```env
AUTH_MODE=admin_proxy
ODOO_USERNAME=admin@yourcompany.com
ODOO_PASSWORD=your-admin-password
```

#### 2. API Key Mode (`AUTH_MODE=api_key`)

Best for teams where users can manage their own API keys.

- Each user generates an API Key in their Odoo profile
- Users connect their account by providing the API Key to the bot
- The bot stores encrypted API keys and uses them for per-user authentication

#### 3. OAuth Mode (`AUTH_MODE=oauth`)

Best for self-hosted Odoo with OAuth provider configured.

- Users authenticate via OAuth flow
- The bot receives and stores access/refresh tokens

#### 4. Service Account Mode (`AUTH_MODE=service_account`)

⚠️ Testing only - not for production. All users share the same Odoo account.

### Odoo Configuration

The bot requires:
- Odoo versions 13 through 18
- XML-RPC enabled
- User with timesheet creation permissions
- Access to `project.project` and `account.analytic.line` models

**Required Odoo Permissions:**
- Read access to projects
- Create access to timesheet entries (account.analytic.line)
- For admin_proxy mode: Read access to `res.users` model (for email lookup)

**Billability Field Support:**
- Odoo 15+: Uses standard `billable` selection field
- Custom implementations: May use `x_is_billable` boolean field (auto-detected)

## Logging

Logs are written to:
- `logs/bot.log` - All logs (info, warn, error)
- `logs/error.log` - Error logs only
- `logs/exceptions.log` - Uncaught exceptions
- `logs/rejections.log` - Unhandled promise rejections
- Console (in development mode)

**Log Levels:** error, warn, info, debug

**Log Rotation:**
- Maximum file size: 10MB
- Maximum files: 5
- Automatic rotation when size limit reached

## Troubleshooting

### Bot doesn't respond

1. **Check bot server is running:**
   ```bash
   curl http://localhost:3978/health
   ```

2. **Verify environment variables:**
   - Ensure all required variables are set in `.env`
   - Check for typos in variable names

3. **Check logs:**
   ```bash
   # Docker
   docker-compose logs -f

   # Local
   tail -f logs/bot.log
   ```

### Parsing fails

1. **Verify Gemini API key:**
   - Test the key is valid
   - Check API quota limits

2. **Check network connectivity:**
   - Ensure access to Google Gemini API
   - Check firewall settings

3. **Review logs for parsing errors:**
   ```bash
   grep "parsing" logs/bot.log
   ```

4. **Try simpler message format:**
   ```
   4 hours on SSI project testing
   ```

### Odoo connection fails

1. **Verify Odoo URL is accessible:**
   ```bash
   curl -I https://your-odoo-instance.com
   ```

2. **Test credentials:**
   - Login to Odoo web interface with same credentials
   - Ensure user has required permissions

3. **Check XML-RPC is enabled:**
   - Contact Odoo administrator
   - Verify firewall allows XML-RPC traffic

4. **Review connection errors:**
   ```bash
   grep "Odoo" logs/error.log
   ```

### Project not found

1. **Ensure projects are active in Odoo:**
   - Projects must have `active = True`
   - Check project visibility settings

2. **Clear cache:**
   ```bash
   # Restart bot to clear cache
   docker-compose restart
   ```

3. **Check user has access:**
   - Verify Odoo user can see projects
   - Check project security rules

### Admin Proxy Issues (admin_proxy mode)

1. **Verify email matching:**
   - Ensure users' Teams emails match their Odoo login emails
   - Check that the Odoo user account is active

2. **Check user lookup:**
   - Run the `status` command to see what email the bot detects
   - Review logs for "lookupUserByEmail" entries

3. **Verify admin permissions:**
   - Admin account needs read access to `res.users` model
   - Admin must be able to create timesheets for other users

### Docker issues

1. **Container won't start:**
   ```bash
   docker-compose logs odoo-teams-bot
   ```

2. **Port already in use:**
   - Change PORT in .env to different value
   - Update docker-compose.yml port mapping

3. **Permission errors:**
   ```bash
   # Fix logs directory permissions
   chmod 755 logs
   ```

## Development

### Project Structure

- **TypeScript** with strict mode enabled
- **Winston** for structured logging
- **Restify** for HTTP server
- **BotBuilder SDK** for Teams integration
- **Multi-stage Docker** build for optimization

### Building TypeScript

```bash
# Clean previous build
npm run clean

# Build
npm run build

# Watch mode (auto-rebuild on changes)
npm run watch
```

### Running Tests

```bash
# Run tests (when implemented)
npm test
```

### Code Quality

The project uses TypeScript strict mode with the following checks:
- No implicit any
- Strict null checks
- Strict function types
- No unused locals/parameters
- No implicit returns
- No fallthrough cases

## Security Best Practices

- **Never commit** `.env` file (included in `.gitignore`)
- **Use environment variables** for all secrets
- **Run as non-root** user in Docker (user `nodejs:1001`)
- **Validate all inputs** before processing
- **Use HTTPS** for Odoo and Gemini API connections
- **Sanitize logs** to avoid leaking sensitive data
- **Enable rate limiting** on bot endpoints (built-in, configurable)
- **Use TOKEN_ENCRYPTION_KEY** for api_key and oauth modes (32+ character key required)

### Security Features

The bot implements comprehensive STRIDE threat model remediation:

| Threat | Mitigation |
|--------|------------|
| **Spoofing** | HMAC-signed OAuth management routes; PKCE for OAuth flows |
| **Tampering** | SHA-256 hash chain for audit logs; HMAC integrity for offline queue |
| **Repudiation** | Comprehensive JSONL audit trail with hash chaining |
| **Information Disclosure** | Email hashing in logs; sensitive data redaction; prompt injection detection |
| **Denial of Service** | Per-user rate limiting; cache size limits; Gemini timeout (30s) |
| **Elevation of Privilege** | Minimum permissions documented; service_account blocked in production |

## Maintenance

### Clearing Project Cache

Projects are cached for 1 hour (configurable). To clear manually:

```bash
# Restart the bot
docker-compose restart
```

### Updating Dependencies

```bash
# Check for updates
npm outdated

# Update all dependencies
npm update

# Rebuild Docker image
docker-compose build
```

### Viewing Logs

```bash
# Real-time logs
docker-compose logs -f

# Last 100 lines
docker-compose logs --tail=100

# Specific service
docker-compose logs odoo-teams-bot
```

## Performance Considerations

1. **Project Caching**
   - Projects cached for 1 hour (configurable)
   - Reduces Odoo API calls
   - Automatic cache cleanup every 5 minutes

2. **Task Filtering**
   - Fuse.js filters tasks locally (no extra API calls)
   - Reduces AI token usage from 10,000 tasks to top 5 matches
   - Fuzzy matching handles typos and partial matches
   - 99%+ token cost reduction for projects with many tasks

3. **Async Operations**
   - Non-blocking I/O throughout
   - Typing indicators during processing
   - Promise-based architecture

4. **Resource Limits**
   - Log rotation prevents disk bloat
   - Memory-efficient caching
   - Docker health checks monitor status

## Support

For issues, questions, or contributions:
- Check the troubleshooting section above
- Review logs for error details
- Contact your system administrator

## License

Modified MIT

## Acknowledgments

- Microsoft Bot Framework
- Google Gemini AI
- Odoo ERP
- Node.js community
