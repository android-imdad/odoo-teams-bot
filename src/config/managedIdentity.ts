import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import { logger } from './logger';

export interface ManagedIdentityConfig {
  enabled: boolean;
  appId: string;
  tenantId?: string;
  clientId?: string; // For user-assigned managed identity
}

export class ManagedIdentityAuth {
  private credential: DefaultAzureCredential | ManagedIdentityCredential | null = null;
  private config: ManagedIdentityConfig;

  constructor(config: ManagedIdentityConfig) {
    this.config = config;

    if (config.enabled) {
      this.initializeCredential();
    }
  }

  /**
   * Initialize Azure credential based on configuration
   * For User-Assigned Managed Identity, we use ManagedIdentityCredential with clientId
   * For local development, DefaultAzureCredential tries multiple authentication methods
   */
  private initializeCredential(): void {
    try {
      // For user-assigned managed identity, we need the clientId
      if (this.config.clientId) {
        this.credential = new ManagedIdentityCredential(this.config.clientId);
        logger.info('Initialized ManagedIdentityCredential for user-assigned managed identity', {
          clientId: this.config.clientId
        });
      } else if (process.env.AZURE_CLIENT_ID) {
        // Fallback to AZURE_CLIENT_ID environment variable
        this.credential = new ManagedIdentityCredential(process.env.AZURE_CLIENT_ID);
        logger.info('Initialized ManagedIdentityCredential from AZURE_CLIENT_ID', {
          clientId: process.env.AZURE_CLIENT_ID
        });
      } else {
        // For local development, use DefaultAzureCredential which tries:
        // 1. Environment variables (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET)
        // 2. Managed Identity
        // 3. Visual Studio Code
        // 4. Azure CLI
        // 5. Azure PowerShell
        // 6. Azure Developer CLI
        this.credential = new DefaultAzureCredential();
        logger.info('Initialized DefaultAzureCredential for local development');
      }
    } catch (error) {
      logger.error('Failed to initialize managed identity credential', { error });
      throw error;
    }
  }

  /**
   * Get the Azure credential
   */
  getCredential(): DefaultAzureCredential | ManagedIdentityCredential | null {
    return this.credential;
  }

  /**
   * Check if managed identity is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the Bot App ID
   */
  getAppId(): string {
    return this.config.appId;
  }

  /**
   * Get access token for Bot Framework authentication
   * This is used when making calls to Bot Framework Service
   */
  async getAccessToken(): Promise<string | null> {
    if (!this.credential) {
      return null;
    }

    try {
      // The scope for Bot Framework token is 'https://api.botframework.com/.default'
      const tokenResponse = await this.credential.getToken('https://api.botframework.com/.default');
      return tokenResponse?.token || null;
    } catch (error) {
      logger.error('Failed to get access token from managed identity', { error });
      return null;
    }
  }
}
