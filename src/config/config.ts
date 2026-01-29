import dotenv from 'dotenv';
import { OdooConfig } from '../types/odoo.types';

dotenv.config();

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
      throw new Error(
        `Missing required environment variables: ${missing.join(', ')}`
      );
    }
  }
}

ConfigValidator.validate();

export const config: Config = {
  bot: {
    appId: process.env.BOT_ID!,
    appPassword: process.env.BOT_PASSWORD!,
    port: parseInt(process.env.PORT || '3978', 10)
  },
  odoo: {
    url: process.env.ODOO_URL!,
    db: process.env.ODOO_DB!,
    username: process.env.ODOO_USERNAME!,
    password: process.env.ODOO_PASSWORD!
  },
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
  environment: process.env.NODE_ENV || 'development'
};
