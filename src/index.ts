import restify from 'restify';
import { BotFrameworkAdapter } from 'botbuilder';
import { config } from './config/config';
import { logger } from './config/logger';
import { TimesheetBot } from './bot';

// Create bot adapter
// Auth is disabled only if credentials are not provided (for local emulator testing)
// For ngrok/Azure testing, credentials must be set in .env
// For Single Tenant bots, specify the tenant ID explicitly
const adapter = new BotFrameworkAdapter({
  appId: config.bot.appId || '',
  appPassword: config.bot.appPassword || '',
  channelAuthTenant: '9e95943a-8a8a-4062-b8b8-4339c2e66f74'
});

// Error handler for adapter
adapter.onTurnError = async (context, error) => {
  logger.error('Unhandled error in bot adapter', {
    error: error.message,
    stack: error.stack,
    activity: context.activity
  });

  await context.sendActivity('Sorry, an unexpected error occurred. Please try again later.');

  // Send trace activity for Bot Framework Emulator
  await context.sendTraceActivity(
    'OnTurnError Trace',
    `${error}`,
    'https://www.botframework.com/schemas/error',
    'TurnError'
  );
};

// Create bot instance
const bot = new TimesheetBot();

// Create HTTP server
const server = restify.createServer({
  name: 'Odoo Teams Bot',
  version: '1.0.0'
});

server.use(restify.plugins.bodyParser());

// Health check endpoint
server.get('/health', (_req, res, next) => {
  res.send(200, {
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
  next();
});

// Bot endpoint
server.post('/api/messages', async (req, res) => {
  // Log incoming requests for debugging
  logger.info('Incoming bot request', {
    method: req.method,
    url: req.url,
    contentType: req.header('content-type'),
    authHeader: req.header('authorization') ? 'present' : 'missing'
  });

  await adapter.process(req, res, (context) => bot.run(context));
});

// Start server
server.listen(config.bot.port, () => {
  logger.info(`Bot server started`, {
    port: config.bot.port,
    environment: config.environment
  });
  console.log(`Bot server listening on port ${config.bot.port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', { reason, promise });
  process.exit(1);
});
