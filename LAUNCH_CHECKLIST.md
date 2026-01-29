# Odoo Teams Bot - Launch Checklist

Use this checklist to deploy and launch your Microsoft Teams bot for Odoo timesheet management.

---

## Prerequisites

- [ ] Node.js v20+ installed
- [ ] npm installed
- [ ] Access to Microsoft Azure account
- [ ] Access to Odoo instance
- [ ] Google account for Gemini API

---

## 1. Get Microsoft Bot Credentials

Register your bot with Azure Bot Service:

- [ ] Go to [Azure Portal](https://portal.azure.com)
- [ ] Create a new "Azure Bot" resource
- [ ] Select "Multi-tenant" or "Single-tenant" as needed
- [ ] Enable "Microsoft Teams" channel
- [ ] Copy the **Microsoft App ID** → set as `BOT_ID` in `.env`
- [ ] Go to "Certificates & secrets"
- [ ] Create a new client secret
- [ ] Copy the secret value → set as `BOT_PASSWORD` in `.env`

---

## 2. Configure Odoo Connection

Update `.env` with your real Odoo instance details:

```bash
ODOO_URL=https://your-odoo-instance.com
ODOO_DB=your-database-name
ODOO_USERNAME=your-username
ODOO_PASSWORD=your-password
```

- [ ] Update `ODOO_URL` with your Odoo instance URL
- [ ] Update `ODOO_DB` with your database name
- [ ] Update `ODOO_USERNAME` with your Odoo username
- [ ] Update `ODOO_PASSWORD` with your Odoo password

---

## 3. Get Gemini API Key

- [ ] Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
- [ ] Sign in with your Google account
- [ ] Click "Create API Key"
- [ ] Copy the API key → set as `GEMINI_API_KEY` in `.env`

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
GEMINI_MODEL=gemini-3-flash-preview

# Cache Configuration
PROJECT_CACHE_TTL=3600000

# Logging Configuration
LOG_LEVEL=info
LOG_FILE=logs/bot.log

# Environment
NODE_ENV=production
```

- [ ] All placeholder values replaced with real credentials
- [ ] No trailing spaces or extra characters

---

## 5. Install Dependencies

```bash
npm install
```

- [ ] Dependencies installed successfully
- [ ] No errors in npm output

---

## 6. Build the Project

```bash
npm run build
```

- [ ] TypeScript compilation successful
- [ ] `dist/` folder created with compiled JavaScript
- [ ] No compilation errors

---

## 7. Run Locally (Development)

```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

- [ ] Server starts on port 3978
- [ ] Console shows "Server listening on http://localhost:3978"

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

- [ ] Health endpoint returns `status: "healthy"`

---

## 9. Connect to Teams

### Option A: Bot Framework Emulator (Local Testing)

- [ ] Install Bot Framework Emulator:
  ```bash
  npm install -g botframework-emulator
  botframework-emulator
  ```

- [ ] Open the Emulator
- [ ] Click "Open Bot"
- [ ] Enter URL: `http://localhost:3978/api/messages`
- [ ] Leave Microsoft App ID and Password empty for local testing
- [ ] Click "Connect"
- [ ] Send a test message: "Log 2 hours on Project X"

### Option B: Deploy to Azure (Production)

- [ ] Build Docker image:
  ```bash
  docker build -t odoo-teams-bot .
  ```

- [ ] Run with Docker:
  ```bash
  docker run -p 3978:3978 --env-file .env odoo-teams-bot
  ```

- [ ] Or use Docker Compose:
  ```bash
  docker-compose up -d
  ```

- [ ] Deploy to your hosting provider (Azure/AWS/GCP)
- [ ] Configure your Azure Bot's endpoint to your deployed URL
- [ ] Add the Microsoft Teams channel in Azure Bot settings

---

## 10. Test the Bot

In Microsoft Teams:

- [ ] Add your bot to a Teams chat or channel
- [ ] Send a test timesheet entry:
  ```
  Log 3 hours on Project A today
  ```
- [ ] Verify the bot responds with an Adaptive Card
- [ ] Verify the timesheet is created in Odoo

---

## 11. Verify Logging

- [ ] Check `logs/bot.log` for entries
- [ ] Verify no critical errors in logs
- [ ] Confirm audit trail is logging user actions

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
| Parsing failures | Verify `GEMINI_API_KEY` is valid |
| Port already in use | Change `PORT` in `.env` or stop conflicting process |
| Odoo connection refused | Verify `ODOO_URL` is accessible from your network |
| TypeScript errors | Run `npm run lint:fix` to auto-fix issues |

---

## Post-Launch

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

**Last Updated**: 2025-01-07
