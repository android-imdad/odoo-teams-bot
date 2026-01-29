# Odoo Teams Bot - Timesheet Management

A Microsoft Teams bot that uses AI to parse natural language timesheet entries and automatically log them to Odoo.

## Features

- **Natural Language Processing**: Uses Google Gemini AI to understand timesheet entries in plain English
- **Interactive Confirmation**: Adaptive Cards provide visual confirmation before saving
- **Automatic Project Matching**: Intelligently matches project names and codes from your Odoo instance
- **Flexible Input**: Supports various date and hour formats
- **Comprehensive Logging**: Advanced Winston-based logging with file rotation
- **Docker Ready**: Containerized deployment for easy setup and scaling

## Prerequisites

- Node.js v20 or higher
- Docker and Docker Compose (for containerized deployment)
- Microsoft Teams Bot registration (Bot ID and Password)
- Odoo instance (versions 13-15) with XML-RPC enabled
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
ODOO_USERNAME=your-username
ODOO_PASSWORD=your-password
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
├── index.ts              # Entry point & HTTP server
├── bot.ts                # Main bot logic
├── config/
│   ├── config.ts         # Configuration management
│   └── logger.ts         # Winston logging setup
├── services/
│   ├── odoo.ts           # Odoo XML-RPC integration
│   ├── parser.ts         # Gemini AI parsing
│   └── cache.ts          # In-memory caching
├── cards/
│   └── timesheetCard.ts  # Adaptive Card generators
├── types/                # TypeScript type definitions
│   ├── index.ts
│   ├── odoo.types.ts
│   └── bot.types.ts
├── middleware/
│   └── errorHandler.ts   # Error handling utilities
└── utils/                # Utility functions
    ├── validation.ts
    └── formatting.ts
```

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| BOT_ID | Microsoft Bot ID | Yes | - |
| BOT_PASSWORD | Microsoft Bot Password | Yes | - |
| PORT | HTTP server port | No | 3978 |
| ODOO_URL | Odoo instance URL | Yes | - |
| ODOO_DB | Odoo database name | Yes | - |
| ODOO_USERNAME | Odoo username | Yes | - |
| ODOO_PASSWORD | Odoo password | Yes | - |
| GEMINI_API_KEY | Google Gemini API key | Yes | - |
| GEMINI_MODEL | Gemini model name | No | gemini-3-flash-preview |
| PROJECT_CACHE_TTL | Project cache duration (ms) | No | 3600000 (1 hour) |
| LOG_LEVEL | Logging level | No | info |
| LOG_FILE | Log file path | No | logs/bot.log |
| NODE_ENV | Environment | No | development |

### Odoo Configuration

The bot requires:
- Odoo versions 13, 14, or 15
- XML-RPC enabled
- User with timesheet creation permissions
- Access to `project.project` and `account.analytic.line` models

**Required Odoo Permissions:**
- Read access to projects
- Create access to timesheet entries (account.analytic.line)

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

2. **Async Operations**
   - Non-blocking I/O throughout
   - Typing indicators during processing
   - Promise-based architecture

3. **Resource Limits**
   - Log rotation prevents disk bloat
   - Memory-efficient caching
   - Docker health checks monitor status

## Support

For issues, questions, or contributions:
- Check the troubleshooting section above
- Review logs for error details
- Contact your system administrator

## License

MIT

## Acknowledgments

- Microsoft Bot Framework
- Google Gemini AI
- Odoo ERP
- Node.js community
