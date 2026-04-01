import { Server, Request, Response, Next } from 'restify';
import crypto from 'crypto';
import { BotFrameworkAdapter } from 'botbuilder';
import { OAuthService } from '../services/oauth';
import { logger } from '../config/logger';
import { escapeHTML } from '../utils/sanitization';

export interface OAuthRoutesConfig {
  adapter: BotFrameworkAdapter;
  bot: any; // TimesheetBot instance
}

/**
 * Validate an HMAC signature for internal bot-to-route requests.
 * Prevents unauthenticated access to OAuth management endpoints (S-2).
 * The signature is: HMAC-SHA256(userId + timestamp, BOT_PASSWORD || BOT_ID).
 * Requests older than 5 minutes are rejected.
 */
function validateInternalSignature(userId: string, signature?: string, timestamp?: string): boolean {
  if (!signature || !timestamp) {
    return false;
  }

  // Reject requests older than 5 minutes
  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime) || Math.abs(Date.now() - requestTime) > 5 * 60 * 1000) {
    return false;
  }

  const secret = process.env.BOT_PASSWORD || process.env.BOT_ID || '';
  if (!secret) {
    logger.warn('Cannot validate signature: no BOT_PASSWORD or BOT_ID set');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${userId}${timestamp}`)
    .digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Generate an HMAC signature for internal requests (for use by the bot).
 */
export function generateInternalSignature(userId: string): { signature: string; timestamp: string } {
  const timestamp = Date.now().toString();
  const secret = process.env.BOT_PASSWORD || process.env.BOT_ID || '';

  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${userId}${timestamp}`)
    .digest('hex');

  return { signature, timestamp };
}

// Helper to handle async route handlers with restify
function asyncHandler(fn: (req: Request, res: Response, next: Next) => Promise<void>) {
  return (req: Request, res: Response, next: Next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function registerOAuthRoutes(
  server: Server,
  oauthService: OAuthService,
  _config: OAuthRoutesConfig,
  rateLimiter?: (req: Request, res: Response, next: Next) => void
): void {

  // Apply rate limiter to all OAuth routes if provided
  const middleware = rateLimiter ? [rateLimiter] : [];

  // OAuth start endpoint - initiates the OAuth flow
  server.get('/auth/oauth/start', ...middleware, asyncHandler(async (req: Request, res: Response, next: Next) => {
    try {
      const { userId, conversationRef } = req.query;

      if (!userId || typeof userId !== 'string') {
        res.send(400, { error: 'Missing required parameter: userId' });
        return next();
      }

      let conversationReference: any;
      try {
        conversationReference = conversationRef
          ? JSON.parse(decodeURIComponent(conversationRef as string))
          : null;
      } catch (e) {
        res.send(400, { error: 'Invalid conversation reference' });
        return next();
      }

      logger.debug('Starting OAuth flow', { userId });

      // Generate OAuth URL
      const authUrl = oauthService.generateAuthUrl(userId, conversationReference);

      // Redirect user to OAuth provider
      res.redirect(authUrl, next);
    } catch (error) {
      logger.error('OAuth start failed', { error });
      res.send(500, { error: 'Failed to initiate OAuth flow' });
      return next();
    }
  }));

  // OAuth callback endpoint - called by OAuth provider after user authorization
  server.get('/auth/oauth/callback', ...middleware, asyncHandler(async (req: Request, res: Response, next: Next) => {
    const { code, state, error: oauthError, error_description } = req.query;

    // Handle OAuth errors (user denied, etc.)
    if (oauthError) {
      logger.error('OAuth authorization error', {
        error: oauthError,
        description: error_description
      });

      res.send(400, {
        error: 'OAuth authorization failed',
        details: escapeHTML(String(error_description || oauthError || 'Unknown error'))
      });
      return next();
    }

    // Validate required parameters
    if (!code || !state) {
      res.send(400, { error: 'Missing required parameters' });
      return next();
    }

    try {
      logger.debug('Processing OAuth callback', { state: (state as string).substring(0, 8) + '...' });

      // Exchange code for tokens and create session
      const session = await oauthService.handleCallback(code as string, state as string);

      // Notify user via bot
      try {
        const conversationRef = await oauthService.getUserSession(session.teamsUserId);
        if (conversationRef?.tokens) {
          // Get the stored conversation reference from the pending state
          // We need to retrieve it differently since it's stored in pending state
          // and already deleted after callback processing
          // For now, just log success - bot will show auth card on next message
        }

        // Send a proactive message if we have a valid conversation reference
        // This requires the adapter and bot to be available
        // We'll handle this in a separate endpoint or via the bot's message handler
      } catch (notifyError) {
        logger.warn('Failed to send success notification', { notifyError });
      }

      // Send success response
      const htmlResponse = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Authentication Successful</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
      text-align: center;
      max-width: 400px;
    }
    .success-icon {
      width: 64px;
      height: 64px;
      background: #48bb78;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
    }
    .success-icon::after {
      content: '✓';
      color: white;
      font-size: 32px;
    }
    h1 {
      color: #2d3748;
      margin: 0 0 10px 0;
      font-size: 24px;
    }
    p {
      color: #718096;
      margin: 0 0 20px 0;
      line-height: 1.5;
    }
    .user-info {
      background: #f7fafc;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .user-info strong {
      color: #2d3748;
    }
    .close-btn {
      background: #667eea;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      transition: background 0.2s;
    }
    .close-btn:hover {
      background: #5a67d8;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon"></div>
    <h1>Authentication Successful!</h1>
    <p>Your Odoo account has been successfully connected to Microsoft Teams.</p>
    <div class="user-info">
      <strong>Connected as:</strong><br>
      ${escapeHTML(session.odooUsername)} (ID: ${session.odooUserId})
    </div>
    <p>You can now close this window and return to Teams to start logging timesheets.</p>
    <button class="close-btn" onclick="window.close()">Close Window</button>
  </div>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      res.send(200, htmlResponse);

      logger.info('OAuth callback processed successfully', {
        teamsUserId: session.teamsUserId,
        odooUserId: session.odooUserId,
        odooUsername: session.odooUsername
      });

      return next();
    } catch (error) {
      logger.error('OAuth callback failed', { error });

      const htmlErrorResponse = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Authentication Failed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.1);
      text-align: center;
      max-width: 400px;
    }
    .error-icon {
      width: 64px;
      height: 64px;
      background: #f56565;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
    }
    .error-icon::after {
      content: '✕';
      color: white;
      font-size: 32px;
    }
    h1 {
      color: #2d3748;
      margin: 0 0 10px 0;
      font-size: 24px;
    }
    p {
      color: #718096;
      margin: 0 0 20px 0;
      line-height: 1.5;
    }
    .error-details {
      background: #fff5f5;
      color: #c53030;
      padding: 15px;
      border-radius: 8px;
      margin: 20px 0;
      font-family: monospace;
      font-size: 14px;
      word-break: break-word;
    }
    .retry-btn {
      background: #f56565;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 16px;
      transition: background 0.2s;
      text-decoration: none;
      display: inline-block;
    }
    .retry-btn:hover {
      background: #e53e3e;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon"></div>
    <h1>Authentication Failed</h1>
    <p>We couldn't connect your Odoo account. Please try again.</p>
    <div class="error-details">
      Authentication could not be completed. Please return to Teams and try again.
    </div>
    <a href="javascript:history.back()" class="retry-btn">Try Again</a>
  </div>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      res.send(500, htmlErrorResponse);
      return next();
    }
  }));

  // Logout endpoint - requires HMAC signature for authentication (S-2)
  // The bot generates signed requests internally; external callers cannot forge them
  server.post('/auth/oauth/revoke', ...middleware, asyncHandler(async (req: Request, res: Response, next: Next) => {
    try {
      const { userId, signature, timestamp } = req.body || {};

      if (!userId) {
        res.send(400, { error: 'Missing required parameter: userId' });
        return next();
      }

      // Validate HMAC signature to prove the request came from the bot
      if (!validateInternalSignature(userId, signature, timestamp)) {
        logger.warn('Unauthorized revoke attempt', { userId });
        res.send(403, { error: 'Forbidden: invalid or missing authentication' });
        return next();
      }

      await oauthService.revokeAuth(userId);

      res.send(200, {
        message: 'Logged out successfully',
        userId
      });
      return next();
    } catch (error) {
      logger.error('OAuth revoke failed', { error });
      res.send(500, { error: 'Failed to logout' });
      return next();
    }
  }));

  // Status endpoint - requires HMAC signature for authentication (S-2)
  server.get('/auth/oauth/status', ...middleware, asyncHandler(async (req: Request, res: Response, next: Next) => {
    try {
      const { userId, signature, timestamp } = req.query;

      if (!userId || typeof userId !== 'string') {
        res.send(400, { error: 'Missing required parameter: userId' });
        return next();
      }

      // Validate HMAC signature to prove the request came from the bot
      if (!validateInternalSignature(userId as string, signature as string, timestamp as string)) {
        logger.warn('Unauthorized status check attempt', { userId });
        res.send(403, { error: 'Forbidden: invalid or missing authentication' });
        return next();
      }

      const isAuthenticated = await oauthService.isAuthenticated(userId);
      const session = isAuthenticated ? await oauthService.getUserSession(userId) : null;

      res.send(200, {
        authenticated: isAuthenticated,
        user: session ? {
          odooUserId: session.odooUserId,
          odooUsername: session.odooUsername,
          updatedAt: session.updatedAt
        } : null
      });
      return next();
    } catch (error) {
      logger.error('OAuth status check failed', { error });
      res.send(500, { error: 'Failed to check authentication status' });
      return next();
    }
  }));

  logger.info('OAuth routes registered');
}
