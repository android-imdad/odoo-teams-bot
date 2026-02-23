export interface OdooConfig {
  url: string;
  db: string;
  username: string;
  password: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in seconds
  scope: string;
  tokenType: string;
}

export interface UserAuthSession {
  teamsUserId: string;
  teamsTenantId: string;
  odooUserId: number;
  odooUsername: string;
  tokens: OAuthTokens;
  createdAt: Date;
  updatedAt: Date;
}

export interface PendingAuthState {
  state: string;
  teamsUserId: string;
  conversationReference: string; // JSON stringified
  expiresAt: number; // Unix timestamp in seconds
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authorizationUrl: string;
  tokenUrl: string;
  scope: string;
}

export interface TokenStorageConfig {
  dbPath: string;
  encryptionKey: string;
}

export interface AuthContext {
  type: 'oauth' | 'api_key' | 'basic';
  accessToken?: string;
  apiKey?: string;
  uid?: number;
}

export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthRequiredError';
    Object.setPrototypeOf(this, AuthRequiredError.prototype);
  }
}

export class TokenExpiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenExpiredError';
    Object.setPrototypeOf(this, TokenExpiredError.prototype);
  }
}
