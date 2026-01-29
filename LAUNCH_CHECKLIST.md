# Odoo Teams Bot - Launch Checklist

Use this checklist to deploy and launch your Microsoft Teams bot for Odoo timesheet management.

---

## Prerequisites

- [x] Node.js v20+ installed
- [x] npm installed
- [x] Access to Microsoft Azure account
- [x] Access to Odoo instance
- [x] Google account for Gemini API

---

## 1. Get Microsoft Bot Credentials

Register your bot with Azure Bot Service:

- [x] Go to [Azure Portal](https://portal.azure.com)
- [x] Create a new "Azure Bot" resource
- [x] Select "Multi-tenant" or "Single-tenant" as needed
- [x] Enable "Microsoft Teams" channel
- [x] Copy the **Microsoft App ID** → set as `BOT_ID` in `.env`
- [x] Go to "Certificates & secrets"
- [x] Create a new client secret
- [x] Copy the secret value → set as `BOT_PASSWORD` in `.env`

**Note**: Keep these credentials secure and never commit `.env` to git.

---

## 2. Configure Odoo Connection

Update `.env` with your real Odoo instance details:

```bash
ODOO_URL=https://your-odoo-instance.com
ODOO_DB=your-database-name
ODOO_USERNAME=your-username
ODOO_PASSWORD=your-password
```

- [x] Update `ODOO_URL` with your Odoo instance URL
- [x] Update `ODOO_DB` with your database name
- [x] Update `ODOO_USERNAME` with your Odoo username
- [x] Update `ODOO_PASSWORD` with your Odoo password

**Note**: If using Odoo Online (trial), the bot handles missing `code` field gracefully.

---

## 3. Get Gemini API Key

- [x] Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
- [x] Sign in with your Google account
- [x] Click "Create API Key"
- [x] Copy the API key → set as `GEMINI_API_KEY` in `.env`

**Recommended Models**:
- `gemini-1.5-flash-latest` - Stable, recommended for production
- `gemini-2.5-flash` - Latest preview model (uses v1beta API)
- Avoid preview models in production unless you need specific features

---

## 4. Verify Environment Configuration

Your `.env` file should look like this:

```bash
# Bot Configuration
BOT_ID=your-real-bot-id
BOT_PASSWORD=your-real-bot-password
PORT=3978

# Odoo Configuration
ODOO_URL=https://your-odoo-instance.com
ODOO_DB=your-database-name
ODOO_USERNAME=your-username
ODOO_PASSWORD=your-password

# Gemini AI Configuration
GEMINI_API_KEY=your-real-gemini-api-key
GEMINI_MODEL=gemini-1.5-flash-latest

# Cache Configuration
PROJECT_CACHE_TTL=3600000

# Logging Configuration
LOG_LEVEL=info
LOG_FILE=logs/bot.log

# Environment
NODE_ENV=production
```

- [x] All placeholder values replaced with real credentials
- [x] No trailing spaces or extra characters

**Quick Setup**:
```bash
cp .env.example .env
# Edit .env with your credentials
```

---

## 5. Install Dependencies

```bash
npm install
```

- [x] Dependencies installed successfully
- [x] No errors in npm output

---

## 6. Build the Project

```bash
npm run build
```

- [x] TypeScript compilation successful
- [x] `dist/` folder created with compiled JavaScript
- [x] No compilation errors

---

## 7. Run Locally (Development)

```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

- [x] Server starts on port 3978
- [x] Console shows "Server listening on http://localhost:3978"

---

## 8. Test Health Endpoint

Open a new terminal and run:

```bash
curl http://localhost:3978/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "...",
  "uptime": ...
}
```

- [x] Health endpoint returns `status: "healthy"`

---

## 9. Connect to Teams

### Option A: Bot Framework Emulator (Local Testing)

**Note**: The bot is configured to allow emulator connections without auth in development mode.

- [x] Install Bot Framework Emulator:
  ```bash
  npm install -g botframework-emulator
  botframework-emulator
  ```

- [x] Open the Emulator
- [x] Click "Open Bot"
- [x] Enter URL: `http://localhost:3978/api/messages`
- [x] Leave Microsoft App ID and Password **empty** for local testing
- [x] Click "Connect"
- [x] Send a test message: "Log 2 hours on Project X"

**Known Emulator Limitations**:
- Card updates (Confirm/Cancel) won't visually replace the card in emulator, but work correctly in real Teams
- The bot will still process actions correctly

---

### Option B: Test with ngrok (Full Azure Integration)

Test Azure authentication without deploying:

```bash
# Install ngrok
npm install -g ngrok

# Start ngrok (in a new terminal)
ngrok http 3978

# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
```

- [ ] In Azure Portal → Bot Configuration → Set Messaging endpoint: `https://abc123.ngrok.io/api/messages`
- [ ] Enable Microsoft Teams channel in Azure
- [ ] Test in Teams with your bot

---

### Option C: Deploy to Azure (Production)

#### Build Docker Image
```bash
docker build -t odoo-teams-bot .
```

#### Run with Docker
```bash
docker run -p 3978:3978 --env-file .env odoo-teams-bot
```

#### Or use Docker Compose
```bash
docker-compose up -d
```

#### Deploy to Azure Web App
```bash
# Login to Azure
az login

# Create resource group
az group create --name odoo-teams-bot-rg --location eastus

# Create App Service plan
az appservice plan create --name odoo-teams-bot-plan --resource-group odoo-teams-bot-rg --sku B1 --is-linux

# Create Web App
az webapp create --resource-group odoo-teams-bot-rg --plan odoo-teams-bot-plan --name odoo-teams-bot-app --deployment-container-image-name odoo-teams-bot:latest

# Configure environment variables in Azure Portal
```

- [ ] Deploy to your hosting provider (Azure/AWS/GCP)
- [ ] Configure your Azure Bot's endpoint to your deployed URL
- [ ] Add the Microsoft Teams channel in Azure Bot settings

---

## 10. Test the Bot

### In Microsoft Teams:

- [ ] Find your bot in Teams (via Azure Bot → Channels → Teams)
- [ ] Add your bot to a Teams chat or channel
- [ ] Send a test timesheet entry:
  ```
  Log 3 hours on Project A today
  ```
- [ ] Verify the bot responds with an Adaptive Card
- [ ] Click "Confirm" and verify the card updates
- [ ] Verify the timesheet is created in Odoo

### Test Natural Language Examples:

```
Log 2 hours on SSI project today
Log 4h on Website Redesign yesterday
Add 3.5 hours to Mobile App for fixing login bug
Log time: 5 hours on Backend API on Monday
```

---

## 11. Verify Logging

- [x] Check `logs/bot.log` for entries
- [x] Verify no critical errors in logs
- [x] Confirm audit trail is logging user actions

**View logs**:
```bash
tail -f logs/bot.log
```

---

## 12. Monitor Metrics

- [ ] Visit metrics endpoint:
  ```bash
  curl http://localhost:3978/metrics
  ```
- [ ] Verify Prometheus metrics are being generated

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Bot not responding | Check `.env` credentials, verify Odoo connectivity |
| Parsing failures | Verify `GEMINI_API_KEY` is valid and model exists |
| 404 on Gemini API | Preview models need v1beta API - bot handles this automatically |
| Port already in use | Change `PORT` in `.env` or stop conflicting process |
| Odoo connection refused | Verify `ODOO_URL` is accessible from your network |
| TypeScript errors | Run `npm run lint:fix` to auto-fix issues |
| Card buttons not working in emulator | Emulator limitation - works correctly in real Teams |
| "Unauthorized" errors in emulator | Bot allows local testing without auth in dev mode |

---

## Post-Launch

- [x] Code pushed to GitHub (`git push origin main`)
- [ ] Set up CI/CD pipeline (`.github/workflows/ci.yml`)
- [ ] Configure monitoring and alerts
- [ ] Review audit logs regularly
- [ ] Scale based on usage (consider load balancer for high traffic)

---

## Resources

- [Comprehensive Documentation](./COMPREHENSIVE_DOCUMENTATION.md)
- [Azure Bot Framework Docs](https://docs.microsoft.com/en-us/azure/bot-service/)
- [Adaptive Cards Designer](https://adaptivecards.io/designer/)
- [Odoo XML-RPC API](https://www.odoo.com/documentation/)

---

**Last Updated**: 2026-01-29

**Status**: Ready for production deployment
