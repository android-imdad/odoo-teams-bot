import restify from 'restify';
import { BotFrameworkAdapter } from 'botbuilder';
import { config } from './config/config';
import { logger } from './config/logger';
import { TimesheetBot } from './bot';
import { TokenStorageService } from './services/tokenStorage';
import { OAuthService } from './services/oauth';
import { ApiKeyAuthService } from './services/apiKeyAuth';
import { TokenRefreshJob } from './services/tokenRefresh';
import { registerOAuthRoutes } from './routes/oauth';
import { OdooService } from './services/odoo';
import { createRateLimiter, RateLimitPresets } from './middleware/rateLimit';
import path from 'path';
import fs from 'fs';

// Authentication-related services (initialized based on config)
let tokenStorage: TokenStorageService | undefined;
let oauthService: OAuthService | undefined;
let apiKeyAuthService: ApiKeyAuthService | undefined;
let tokenRefreshJob: TokenRefreshJob | undefined;
let odooService: OdooService;

// Authentication mode: 'service_account' | 'oauth' | 'api_key' | 'admin_proxy'
const AUTH_MODE = process.env.AUTH_MODE || 'api_key'; // Default to API key for multi-user support

/**
 * Initialize authentication services based on AUTH_MODE
 */
async function initializeAuth(): Promise<void> {
  // Initialize token storage for api_key and oauth modes
  if (AUTH_MODE === 'api_key' || AUTH_MODE === 'oauth') {
    try {
      const dbPath = config.tokenStorage?.dbPath || './data/tokens.db';
      const dbDir = path.dirname(dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        logger.info('Created data directory', { path: dbDir });
      }

      const encryptionKey = config.tokenStorage?.encryptionKey;
      if (!encryptionKey || encryptionKey.length < 16) {
        throw new Error(
          'TOKEN_ENCRYPTION_KEY is required for api_key and oauth modes and must be at least 16 characters. ' +
          'Generate a secure key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
        );
      }
      // Reject well-known default/placeholder keys
      const insecureKeys = ['default-key-32-chars-long!!!!!', 'YOUR_API_KEY_HERE', 'changeme', 'password'];
      if (insecureKeys.some(k => encryptionKey.includes(k))) {
        throw new Error(
          'TOKEN_ENCRYPTION_KEY is set to an insecure default value. ' +
          'Generate a secure key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
        );
      }
      tokenStorage = new TokenStorageService({ dbPath, encryptionKey });
      await tokenStorage.initialize();
      logger.info('Token storage initialized');
    } catch (error) {
      logger.error('Failed to initialize token storage', { error });
      throw error;
    }
  }

  // Initialize OAuth if enabled
  if (AUTH_MODE === 'oauth' && config.oauthEnabled && config.oauth) {
    try {
      oauthService = new OAuthService(config.oauth, tokenStorage!);
      logger.info('OAuth service initialized');

      tokenRefreshJob = new TokenRefreshJob(oauthService, tokenStorage!);
      tokenRefreshJob.start();
      logger.info('Token refresh job started');
    } catch (error) {
      logger.error('Failed to initialize OAuth services', { error });
      throw error;
    }
  }

  // Initialize API Key auth if enabled
  if (AUTH_MODE === 'api_key' && tokenStorage) {
    try {
      apiKeyAuthService = new ApiKeyAuthService(tokenStorage);
      logger.info('API Key authentication service initialized');
    } catch (error) {
      logger.error('Failed to initialize API Key auth service', { error });
      throw error;
    }
  }

  if (AUTH_MODE === 'admin_proxy') {
    logger.info('Admin proxy mode enabled - timesheets will be logged via admin account with user email lookup');
    logger.warn(
      'SECURITY: Ensure the admin proxy service account has minimal Odoo permissions. ' +
      'Required: READ project.project, project.task, res.users; CREATE account.analytic.line, project.task. ' +
      'See src/services/odoo.ts for full documentation (E-1).'
    );
  }

  if (AUTH_MODE === 'service_account') {
    logger.info('Using service account mode (single user)');
  }
}

// Bot instance (created after services are initialized)
let bot: TimesheetBot;

// Create bot adapter
// For managed identity: appId is required, appPassword is empty
// For traditional auth: both appId and appPassword are required
const adapterSettings = config.managedIdentity.enabled
  ? {
      appId: config.bot.appId,
      // For managed identity, we don't need appPassword
      // The adapter will use the app ID to authenticate incoming requests
      appPassword: '',
      // For single-tenant bots, set the tenant ID for token validation
      ...(config.bot.tenantId && { channelAuthTenant: config.bot.tenantId })
    }
  : {
      appId: config.bot.appId || '',
      appPassword: config.bot.appPassword || '',
      // For single-tenant bots, set the tenant ID for token validation
      ...(config.bot.tenantId && { channelAuthTenant: config.bot.tenantId })
    };

const adapter = new BotFrameworkAdapter(adapterSettings);

// Log managed identity status
if (config.managedIdentity.enabled) {
  logger.info('Managed identity authentication enabled', {
    appId: config.managedIdentity.appId,
    clientId: config.managedIdentity.clientId
  });
}

// Log single-tenant configuration
if (config.bot.tenantId) {
  logger.info('Single-tenant bot configured', {
    tenantId: config.bot.tenantId,
    appId: config.bot.appId
  });
}

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

// Create HTTP server
const server = restify.createServer({
  name: 'Odoo Teams Bot',
  version: '1.0.0'
});

server.use(restify.plugins.queryParser());
server.use(restify.plugins.bodyParser());

// Health check endpoint
server.get('/health', (_req, res, next) => {
  const healthStatus: any = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    authMode: AUTH_MODE
  };

  if (tokenStorage) {
    healthStatus.tokenStorage = 'connected';
  }

  res.send(200, healthStatus);
  next();
});

// Rate limiting middleware for bot messages endpoint
const botMessageRateLimiter = createRateLimiter(RateLimitPresets.BOT_MESSAGES);

// Stricter rate limiter for OAuth endpoints
const oauthRateLimiter = createRateLimiter({
  requests: 10,
  windowMs: 60000, // 10 requests per minute
  skip: (req) => req.path() === '/health'
});

// Bot endpoint (registered after bot is created)
let botEndpointRegistered = false;

function registerBotEndpoint(): void {
  if (botEndpointRegistered) return;

  server.post('/api/messages', botMessageRateLimiter, async (req, res) => {
    // Log incoming requests for debugging (redact body for security - I-1)
    logger.info('Incoming bot request', {
      method: req.method,
      url: req.url,
      contentType: req.header('content-type'),
      authHeader: req.header('authorization') ? 'present' : 'missing'
    });

    await adapter.process(req, res, (context) => bot.run(context));
  });

  botEndpointRegistered = true;
}

// Start server and initialize services
async function startServer(): Promise<void> {
  try {
    // Initialize authentication services
    await initializeAuth();

    // Initialize Odoo service with appropriate auth services
    const isAdminProxyMode = AUTH_MODE === 'admin_proxy';
    odooService = new OdooService(config.odoo, oauthService, apiKeyAuthService, isAdminProxyMode);
    logger.info('Odoo service initialized', { authMode: AUTH_MODE, adminProxyMode: isAdminProxyMode });

    // Create bot instance with initialized services
    const useApiKeyAuth = AUTH_MODE === 'api_key';
    bot = new TimesheetBot(oauthService, apiKeyAuthService, odooService, useApiKeyAuth, isAdminProxyMode);

    // Register bot endpoint
    registerBotEndpoint();

    // Register OAuth routes if enabled
    if (oauthService) {
      registerOAuthRoutes(server, oauthService, { adapter, bot }, oauthRateLimiter);
    }

    // Start HTTP server
    server.listen(config.bot.port, () => {
      // Show prominent warning for service account mode
      if (AUTH_MODE === 'service_account') {
        console.warn('\n' + '='.repeat(70));
        console.warn('⚠️  WARNING: RUNNING IN SERVICE ACCOUNT MODE (TESTING ONLY)');
        console.warn('='.repeat(70));
        console.warn('All users will share the same Odoo account.');
        console.warn('Timesheets will be logged as: ' + config.odoo.username);
        console.warn('This mode is NOT suitable for production use.');
        console.warn('Use API Key or OAuth authentication for multi-user support.');
        console.warn('='.repeat(70) + '\n');

        logger.warn('Service account mode active - all users share same Odoo account', {
          username: config.odoo.username
        });
      }

      logger.info(`Bot server started`, {
        port: config.bot.port,
        environment: config.environment,
        authMode: AUTH_MODE,
        managedIdentity: config.managedIdentity.enabled
      });
      console.log(`Bot server listening on port ${config.bot.port}`);

      // Log authentication mode
      if (config.managedIdentity.enabled) {
        console.log(`\n🔒 Managed Identity Authentication Enabled`);
        console.log(`  Bot App ID: ${config.bot.appId}`);
        if (config.managedIdentity.clientId) {
          console.log(`  Managed Identity Client ID: ${config.managedIdentity.clientId}`);
        }
        console.log(`  No BOT_PASSWORD required - using Azure Managed Identity\n`);
      } else {
        console.log(`Bot App ID: ${config.bot.appId}`);
      }

      if (AUTH_MODE === 'oauth') {
        console.log(`OAuth endpoints available at ${config.bot.publicUrl}/auth/oauth/*`);
      } else if (AUTH_MODE === 'api_key') {
        console.log(`API Key authentication enabled for multi-user support`);
      } else if (AUTH_MODE === 'admin_proxy') {
        console.log(`Admin Proxy mode enabled - timesheets logged via admin account with user email lookup`);
      } else {
        console.log(`Service account mode (single user)`);
      }
    });

  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully');

  // Stop token refresh job
  if (tokenRefreshJob) {
    tokenRefreshJob.stop();
    logger.info('Token refresh job stopped');
  }

  // Close token storage
  if (tokenStorage) {
    await tokenStorage.close();
    logger.info('Token storage closed');
  }

  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully');

  // Stop token refresh job
  if (tokenRefreshJob) {
    tokenRefreshJob.stop();
    logger.info('Token refresh job stopped');
  }

  // Close token storage
  if (tokenStorage) {
    await tokenStorage.close();
    logger.info('Token storage closed');
  }

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

// Start the server
startServer();
