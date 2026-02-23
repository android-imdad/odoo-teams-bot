/**
 * Tests for Auth Card generators
 */

import {
  createAuthCard,
  createAuthSuccessCard,
  createReauthCard,
  createConnectionStatusCard,
  buildAuthUrl
} from '../../src/cards/authCard';
import { TurnContext } from 'botbuilder';

// Helper to extract card content from attachment
function getCardContent(attachment: any): any {
  return attachment.content;
}

describe('Auth Cards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createAuthCard', () => {
    it('should create authentication card with required fields', () => {
      const attachment: any = createAuthCard({
        userId: 'user-123',
        authUrl: 'https://bot.example.com/auth'
      });

      expect(attachment).toBeDefined();
      expect(attachment.contentType).toBe('application/vnd.microsoft.card.adaptive');

      const card = getCardContent(attachment);
      expect(card.type).toBe('AdaptiveCard');
      expect(card.version).toBe('1.3');
      expect(card.body).toHaveLength(4);
      expect(card.actions).toHaveLength(2);
    });

    it('should use default title and message', () => {
      const attachment: any = createAuthCard({
        userId: 'user-123',
        authUrl: 'https://bot.example.com/auth'
      });

      const card = getCardContent(attachment);
      const titleBlock = card.body[0];
      expect(titleBlock.text).toBe('Connect Your Odoo Account');

      const messageBlock = card.body[1];
      expect(messageBlock.text).toContain('To log timesheets in Odoo');
    });

    it('should use custom title and message when provided', () => {
      const attachment: any = createAuthCard({
        userId: 'user-123',
        authUrl: 'https://bot.example.com/auth',
        title: 'Custom Title',
        message: 'Custom message'
      });

      const card = getCardContent(attachment);
      expect(card.body[0].text).toBe('Custom Title');
      expect(card.body[1].text).toBe('Custom message');
    });

    it('should include connect action with auth URL', () => {
      const attachment: any = createAuthCard({
        userId: 'user-123',
        authUrl: 'https://bot.example.com/auth'
      });

      const card = getCardContent(attachment);
      const connectAction = card.actions[0];
      expect(connectAction.type).toBe('Action.OpenUrl');
      expect(connectAction.title).toBe('Connect to Odoo');
      expect(connectAction.url).toBe('https://bot.example.com/auth');
      expect(connectAction.style).toBe('positive');
    });

    it('should include help action', () => {
      const attachment: any = createAuthCard({
        userId: 'user-123',
        authUrl: 'https://bot.example.com/auth'
      });

      const card = getCardContent(attachment);
      const helpAction = card.actions[1];
      expect(helpAction.type).toBe('Action.Submit');
      expect(helpAction.title).toBe('Help');
      expect(helpAction.data.action).toBe('help');
    });

    it('should list benefits in FactSet', () => {
      const attachment: any = createAuthCard({
        userId: 'user-123',
        authUrl: 'https://bot.example.com/auth'
      });

      const card = getCardContent(attachment);
      const factSet = card.body[3];
      expect(factSet.type).toBe('FactSet');
      expect(factSet.facts).toHaveLength(4);
      expect(factSet.facts[0].value).toContain('Log timesheets');
      expect(factSet.facts[1].value).toContain('projects and tasks');
    });
  });

  describe('createAuthSuccessCard', () => {
    it('should create success card', () => {
      const attachment: any = createAuthSuccessCard('Test User');

      expect(attachment.contentType).toBe('application/vnd.microsoft.card.adaptive');

      const card = getCardContent(attachment);
      expect(card.type).toBe('AdaptiveCard');
      expect(card.version).toBe('1.3');
      expect(card.body).toHaveLength(4);
    });

    it('should show success message with username', () => {
      const attachment: any = createAuthSuccessCard('Test User');

      const card = getCardContent(attachment);
      expect(card.body[0].text).toBe('✅ Connected Successfully');
      expect(card.body[1].text).toContain('Test User');
    });

    it('should include example usage', () => {
      const attachment: any = createAuthSuccessCard('Test User');

      const card = getCardContent(attachment);
      const exampleBlock = card.body[3];
      expect(exampleBlock.text).toContain('4 hours on Website project');
      expect(exampleBlock.style).toBe('code');
    });
  });

  describe('createReauthCard', () => {
    it('should create re-authentication card', () => {
      const attachment: any = createReauthCard('https://bot.example.com/auth');

      const card = getCardContent(attachment);
      expect(card.type).toBe('AdaptiveCard');
      expect(card.version).toBe('1.3');
      expect(card.body).toHaveLength(2);
      expect(card.actions).toHaveLength(1);
    });

    it('should show warning styling', () => {
      const attachment: any = createReauthCard('https://bot.example.com/auth');

      const card = getCardContent(attachment);
      expect(card.body[0].text).toBe('Session Expired');
      expect(card.body[0].color).toBe('Warning');
    });

    it('should include reconnect action', () => {
      const attachment: any = createReauthCard('https://bot.example.com/auth');

      const card = getCardContent(attachment);
      const action = card.actions[0];
      expect(action.type).toBe('Action.OpenUrl');
      expect(action.title).toBe('Reconnect to Odoo');
      expect(action.url).toBe('https://bot.example.com/auth');
      expect(action.style).toBe('positive');
    });
  });

  describe('createConnectionStatusCard', () => {
    it('should create connected status card', () => {
      const attachment: any = createConnectionStatusCard(true, 'Test User');

      const card = getCardContent(attachment);
      expect(card.type).toBe('AdaptiveCard');
      expect(card.version).toBe('1.3');
      expect(card.body).toHaveLength(2);
      expect(card.actions).toHaveLength(1);
    });

    it('should show connected state', () => {
      const attachment: any = createConnectionStatusCard(true, 'Test User');

      const card = getCardContent(attachment);
      const statusColumn = card.body[1].columns[1];
      expect(statusColumn.items[0].text).toBe('Connected');
      expect(statusColumn.items[0].color).toBe('Good');
      expect(statusColumn.items[1].text).toContain('Test User');
    });

    it('should include disconnect action when connected', () => {
      const attachment: any = createConnectionStatusCard(true, 'Test User');

      const card = getCardContent(attachment);
      const action = card.actions[0];
      expect(action.type).toBe('Action.Submit');
      expect(action.title).toBe('Disconnect');
      expect(action.data.action).toBe('disconnect_odoo');
      expect(action.style).toBe('destructive');
    });

    it('should create disconnected status card', () => {
      const attachment: any = createConnectionStatusCard(false);

      const card = getCardContent(attachment);
      expect(card.body).toHaveLength(2);
    });

    it('should show disconnected state', () => {
      const attachment: any = createConnectionStatusCard(false);

      const card = getCardContent(attachment);
      const statusColumn = card.body[1].columns[1];
      expect(statusColumn.items[0].text).toBe('Not Connected');
      expect(statusColumn.items[0].color).toBe('Attention');
    });

    it('should include connect action when disconnected with authUrl', () => {
      const attachment: any = createConnectionStatusCard(false, undefined, 'https://bot.example.com/auth');

      const card = getCardContent(attachment);
      const action = card.actions[0];
      expect(action.type).toBe('Action.OpenUrl');
      expect(action.title).toBe('Connect to Odoo');
      expect(action.url).toBe('https://bot.example.com/auth');
      expect(action.style).toBe('positive');
    });

    it('should not include actions when disconnected without authUrl', () => {
      const attachment: any = createConnectionStatusCard(false);

      const card = getCardContent(attachment);
      expect(card.actions).toHaveLength(0);
    });
  });

  describe('buildAuthUrl', () => {
    const mockContext = {
      activity: {
        id: 'activity-123',
        conversation: {
          id: 'conv-123',
          tenantId: 'tenant-456'
        },
        serviceUrl: 'https://smba.trafficmanager.net/'
      }
    } as TurnContext;

    it('should build auth URL with all parameters', () => {
      const url = buildAuthUrl('https://bot.example.com', 'user-123', mockContext);

      expect(url).toContain('https://bot.example.com/auth/oauth/start');
      expect(url).toContain('userId=user-123');
      expect(url).toContain('conversationRef=');
    });

    it('should handle baseUrl with trailing slash', () => {
      const url = buildAuthUrl('https://bot.example.com/', 'user-123', mockContext);

      expect(url).toContain('https://bot.example.com/auth/oauth/start');
      expect(url).not.toContain('//auth');
    });

    it('should encode userId', () => {
      const url = buildAuthUrl('https://bot.example.com', 'user@example.com', mockContext);

      expect(url).toContain('userId=' + encodeURIComponent('user@example.com'));
    });

    it('should encode conversation reference', () => {
      const url = buildAuthUrl('https://bot.example.com', 'user-123', mockContext);

      const match = url.match(/conversationRef=([^&]+)/);
      expect(match).toBeTruthy();

      const decoded = decodeURIComponent(match![1]);
      const ref = JSON.parse(decoded);
      expect(ref.conversation.id).toBe('conv-123');
    });
  });
});
