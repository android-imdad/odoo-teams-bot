import dotenv from 'dotenv';
import { OdooConfig, OAuthConfig, TokenStorageConfig } from '../types/oauth.types';

dotenv.config();

interface Config {
  bot: {
    appId: string;
    appPassword: string;
    port: number;
    publicUrl: string;
  };
  odoo: OdooConfig;
  oauth?: OAuthConfig;
  tokenStorage?: TokenStorageConfig;
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
  oauthEnabled: boolean;
}

class ConfigValidator {
  private static requiredEnvVars = [
    'ODOO_URL',
    'ODOO_DB',
    'GEMINI_API_KEY'
  ];

  static validate(): void {
    const missing = this.requiredEnvVars.filter(
      varName => !process.env[varName]
    );

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(', ')}`
      );
    }

    // Validate auth mode
    const authMode = process.env.AUTH_MODE || 'api_key';
    const validAuthModes = ['service_account', 'oauth', 'api_key', 'admin_proxy'];

    if (!validAuthModes.includes(authMode)) {
      throw new Error(
        `Invalid AUTH_MODE: ${authMode}. Must be one of: ${validAuthModes.join(', ')}`
      );
    }

    // Validate that service account mode is only used in development
    if (authMode === 'service_account') {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          'Service account mode (AUTH_MODE=service_account) is not allowed in production. ' +
          'Please use AUTH_MODE=api_key, AUTH_MODE=oauth, or AUTH_MODE=admin_proxy for per-user authentication.'
        );
      }
      console.warn('⚠️  WARNING: Using service account mode. This should only be used for testing/development.');
      console.warn('   All users will share the same Odoo account. Timesheets will be logged as the service account user.');
      console.warn('   For production, use API Key, OAuth, or Admin Proxy authentication instead.\n');
    }

    // Validate admin_proxy mode requires service account credentials
    if (authMode === 'admin_proxy') {
      if (!process.env.ODOO_USERNAME || !process.env.ODOO_PASSWORD) {
        throw new Error(
          'Admin proxy mode (AUTH_MODE=admin_proxy) requires ODOO_USERNAME and ODOO_PASSWORD ' +
          'for the admin service account that will log timesheets on behalf of users.'
        );
      }
    }

    // Validate OAuth config if OAuth is enabled
    if (process.env.OAUTH_ENABLED === 'true') {
      const oauthRequired = [
        'ODOO_OAUTH_CLIENT_ID',
        'ODOO_OAUTH_CLIENT_SECRET',
        'ODOO_OAUTH_REDIRECT_URI',
        'TOKEN_ENCRYPTION_KEY'
      ];

      const oauthMissing = oauthRequired.filter(
        varName => !process.env[varName]
      );

      if (oauthMissing.length > 0) {
        throw new Error(
          `OAuth enabled but missing required variables: ${oauthMissing.join(', ')}`
        );
      }

      // Validate encryption key length
      const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY || '';
      if (encryptionKey.length < 16) {
        throw new Error(
          'TOKEN_ENCRYPTION_KEY must be at least 16 characters long'
        );
      }
    }
  }
}

ConfigValidator.validate();

// Check if OAuth is enabled
const oauthEnabled = process.env.OAUTH_ENABLED === 'true';

// Build OAuth config if enabled
const oauthConfig: OAuthConfig | undefined = oauthEnabled
  ? {
      clientId: process.env.ODOO_OAUTH_CLIENT_ID!,
      clientSecret: process.env.ODOO_OAUTH_CLIENT_SECRET!,
      redirectUri: process.env.ODOO_OAUTH_REDIRECT_URI!,
      authorizationUrl: process.env.ODOO_OAUTH_AUTH_URL || `${process.env.ODOO_URL}/oauth/authorize`,
      tokenUrl: process.env.ODOO_OAUTH_TOKEN_URL || `${process.env.ODOO_URL}/oauth/token`,
      scope: process.env.ODOO_OAUTH_SCOPE || 'read write'
    }
  : undefined;

// Build token storage config if OAuth enabled
const tokenStorageConfig: TokenStorageConfig | undefined = oauthEnabled
  ? {
      dbPath: process.env.TOKEN_DB_PATH || './data/tokens.db',
      encryptionKey: process.env.TOKEN_ENCRYPTION_KEY!
    }
  : undefined;

export const config: Config = {
  bot: {
    appId: process.env.BOT_ID!,
    appPassword: process.env.BOT_PASSWORD!,
    port: parseInt(process.env.PORT || '3978', 10),
    publicUrl: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || '3978'}`
  },
  odoo: {
    url: process.env.ODOO_URL!,
    db: process.env.ODOO_DB!,
    username: process.env.ODOO_USERNAME || '',
    password: process.env.ODOO_PASSWORD || ''
  },
  oauth: oauthConfig,
  tokenStorage: tokenStorageConfig,
  gemini: {
    apiKey: process.env.GEMINI_API_KEY!,
    model: process.env.GEMINI_MODEL || 'gemini-3-flash-preview'
  },
  cache: {
    projectTtl: parseInt(process.env.PROJECT_CACHE_TTL || '3600000', 10)
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || 'logs/bot.log'
  },
  environment: process.env.NODE_ENV || 'development',
  oauthEnabled
};
