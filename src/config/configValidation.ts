/**
 * Configuration validation with schema validation.
 * Ensures all required configuration is present and valid at startup.
 */

import dotenv from 'dotenv';
import { logger } from './logger';

dotenv.config();

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface ConfigSchema {
  required: boolean;
  type: 'string' | 'number' | 'boolean' | 'url' | 'email';
  validator?: (value: any) => boolean;
  defaultValue?: any;
  envVar: string;
  description: string;
}

class ConfigValidator {
  private schema: Record<string, ConfigSchema> = {
    // Bot Configuration
    BOT_ID: {
      required: true,
      type: 'string',
      envVar: 'BOT_ID',
      description: 'Microsoft Teams Bot Application ID'
    },
    BOT_PASSWORD: {
      required: true,
      type: 'string',
      envVar: 'BOT_PASSWORD',
      description: 'Microsoft Teams Bot Client Secret'
    },
    PORT: {
      required: false,
      type: 'number',
      validator: (v) => {
        const num = parseInt(v, 10);
        return num > 0 && num < 65536;
      },
      defaultValue: '3978',
      envVar: 'PORT',
      description: 'Server port'
    },

    // Odoo Configuration
    ODOO_URL: {
      required: true,
      type: 'url',
      envVar: 'ODOO_URL',
      description: 'Odoo instance URL'
    },
    ODOO_DB: {
      required: true,
      type: 'string',
      envVar: 'ODOO_DB',
      description: 'Odoo database name'
    },
    ODOO_USERNAME: {
      required: true,
      type: 'string',
      envVar: 'ODOO_USERNAME',
      description: 'Odoo username'
    },
    ODOO_PASSWORD: {
      required: true,
      type: 'string',
      envVar: 'ODOO_PASSWORD',
      description: 'Odoo password'
    },

    // Gemini AI Configuration
    GEMINI_API_KEY: {
      required: true,
      type: 'string',
      validator: (v) => v.startsWith('AI') && v.length > 10,
      envVar: 'GEMINI_API_KEY',
      description: 'Google Gemini API key'
    },
    GEMINI_MODEL: {
      required: false,
      type: 'string',
      defaultValue: 'gemini-3-flash-preview',
      envVar: 'GEMINI_MODEL',
      description: 'Gemini AI model name'
    },

    // Cache Configuration
    PROJECT_CACHE_TTL: {
      required: false,
      type: 'number',
      validator: (v) => parseInt(v, 10) > 0,
      defaultValue: '3600000',
      envVar: 'PROJECT_CACHE_TTL',
      description: 'Project cache TTL in milliseconds'
    },

    // Logging Configuration
    LOG_LEVEL: {
      required: false,
      type: 'string',
      validator: (v) => ['error', 'warn', 'info', 'debug'].includes(v),
      defaultValue: 'info',
      envVar: 'LOG_LEVEL',
      description: 'Logging level'
    },
    LOG_FILE: {
      required: false,
      type: 'string',
      defaultValue: 'logs/bot.log',
      envVar: 'LOG_FILE',
      description: 'Log file path'
    },

    // Environment
    NODE_ENV: {
      required: false,
      type: 'string',
      validator: (v) => ['development', 'production', 'test'].includes(v),
      defaultValue: 'development',
      envVar: 'NODE_ENV',
      description: 'Application environment'
    }
  };

  /**
   * Validate a single value
   */
  private validateValue(_key: string, schema: ConfigSchema, value: any): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if required value is present
    if (schema.required && (value === undefined || value === null || value === '')) {
      errors.push(`Missing required environment variable: ${schema.envVar}`);
      return { valid: false, errors, warnings };
    }

    // Use default value if not provided
    if (value === undefined || value === null || value === '') {
      if (schema.defaultValue !== undefined) {
        value = schema.defaultValue;
        warnings.push(`Using default value for ${schema.envVar}: ${schema.defaultValue}`);
      }
    }

    // Type validation
    if (value !== undefined && value !== null) {
      switch (schema.type) {
        case 'number':
          if (isNaN(parseInt(value, 10))) {
            errors.push(`${schema.envVar} must be a number`);
          }
          break;

        case 'boolean':
          if (!['true', 'false', '0', '1'].includes(String(value))) {
            errors.push(`${schema.envVar} must be a boolean (true/false)`);
          }
          break;

        case 'url':
          try {
            new URL(value);
          } catch {
            errors.push(`${schema.envVar} must be a valid URL`);
          }
          break;

        case 'email':
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(value)) {
            errors.push(`${schema.envVar} must be a valid email address`);
          }
          break;
      }

      // Custom validator
      if (schema.validator && !schema.validator(value)) {
        errors.push(`${schema.envVar} failed validation: ${schema.description}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate all configuration
   */
  public validate(): ValidationResult {
    const allErrors: string[] = [];
    const allWarnings: string[] = [];

    for (const [key, schema] of Object.entries(this.schema)) {
      const value = process.env[schema.envVar];
      const result = this.validateValue(key, schema, value);

      allErrors.push(...result.errors);
      allWarnings.push(...result.warnings);
    }

    // Log warnings
    for (const warning of allWarnings) {
      logger.warn(warning);
    }

    // Log errors and throw if invalid
    if (allErrors.length > 0) {
      logger.error('Configuration validation failed', { errors: allErrors });
      return { valid: false, errors: allErrors, warnings: allWarnings };
    }

    logger.info('Configuration validation passed');
    return { valid: true, errors: [], warnings: allWarnings };
  }

  /**
   * Get configuration as object
   */
  public getConfig(): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [, schema] of Object.entries(this.schema)) {
      const value = process.env[schema.envVar] ?? schema.defaultValue;
      result[schema.envVar] = value;
    }

    return result;
  }

  /**
   * Get schema documentation
   */
  public getDocumentation(): string {
    let doc = 'Configuration Documentation\n';
    doc += '===========================\n\n';

    for (const [, schema] of Object.entries(this.schema)) {
      doc += `${schema.envVar}\n`;
      doc += `  Description: ${schema.description}\n`;
      doc += `  Required: ${schema.required ? 'Yes' : 'No'}\n`;
      doc += `  Type: ${schema.type}\n`;
      if (schema.defaultValue !== undefined) {
        doc += `  Default: ${schema.defaultValue}\n`;
      }
      doc += '\n';
    }

    return doc;
  }
}

// Export validator instance
export const configValidator = new ConfigValidator();

// Validate on import (only in non-test environments)
if (process.env.NODE_ENV !== 'test') {
  const validation = configValidator.validate();
  if (!validation.valid) {
    throw new Error(`Configuration validation failed:\n${validation.errors.join('\n')}`);
  }
}

export type { ValidationResult, ConfigSchema };
