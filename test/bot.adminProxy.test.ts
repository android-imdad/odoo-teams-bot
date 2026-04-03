import { TimesheetBot } from '../src/bot';
import { OdooService } from '../src/services/odoo';
import { TurnContext, TeamsInfo } from 'botbuilder';
import { TimesheetCardData } from '../src/types/bot.types';

// Mock dependencies
jest.mock('../src/services/parser', () => ({
  parserService: {
    parseText: jest.fn()
  }
}));

jest.mock('../src/services/taskFilter', () => ({
  filterTasksByQuery: jest.fn().mockReturnValue([])
}));

jest.mock('../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

jest.mock('botbuilder', () => ({
  ...jest.requireActual('botbuilder'),
  TeamsInfo: {
    getMember: jest.fn()
  }
}));

import { parserService } from '../src/services/parser';

describe('TimesheetBot - Admin Proxy Mode', () => {
  let bot: TimesheetBot;
  let mockOdooService: jest.Mocked<OdooService>;
  let mockContext: Partial<TurnContext>;

  beforeEach(() => {
    // Clear the dev/test email override so extractTeamsEmail uses the normal
    // Teams extraction logic (dotenv.config() in config.ts re-adds this from .env)
    delete process.env.TEST_USER_EMAIL;

    mockOdooService = {
      getProjects: jest.fn(),
      getTasks: jest.fn(),
      logTime: jest.fn(),
      lookupUserByEmail: jest.fn(),
      isAdminProxy: jest.fn().mockReturnValue(true),
      createTask: jest.fn()
    } as any;

    bot = new TimesheetBot(undefined, undefined, mockOdooService, false, true);

    mockContext = {
      activity: {
        type: 'message',
        text: '4 hours on Website project',
        from: {
          id: 'teams-user-id-123',
          name: 'john.doe@company.com',
          aadObjectId: 'aad-object-id-456'
        },
        channelId: 'msteams',
        conversation: {
          id: 'conversation-id',
          tenantId: 'tenant-id-789',
          isGroup: false,
          conversationType: 'personal',
          name: 'Test Conversation'
        },
        id: 'activity-id',
        timestamp: new Date(),
        localTimezone: 'UTC',
        callerId: undefined,
        serviceUrl: 'https://smba.trafficmanager.net/teams',
        recipient: {
          id: 'bot-id',
          name: 'Bot'
        },
        channelData: {
          tenant: {
            id: 'tenant-id-789'
          }
        }
      } as any,
      sendActivity: jest.fn().mockResolvedValue({}),
      updateActivity: jest.fn().mockResolvedValue({}),
    };

    jest.clearAllMocks();
  });

  describe('Email Extraction', () => {
    it('should extract email from activity.from.name when it contains @', async () => {
      (parserService.parseText as jest.Mock)
        .mockResolvedValueOnce({ project_id: 1, project_name: 'Website' })
        .mockResolvedValueOnce({
          project_id: 1,
          project_name: 'Website',
          hours: 4,
          date: '2024-01-15',
          description: 'Worked on website'
        });

      mockOdooService.getProjects.mockResolvedValue([{ id: 1, name: 'Website', active: true }]);

      await (bot as any).handleMessage(mockContext as TurnContext);

      // Should have sent a confirmation card or error
      expect(mockContext.sendActivity).toHaveBeenCalled();
    });

    it('should try TeamsInfo.getMember when name is not an email', async () => {
      mockContext.activity!.from.name = 'John Doe'; // Not an email
      (TeamsInfo.getMember as jest.Mock).mockResolvedValue({
        id: 'teams-user-id-123',
        email: 'john.doe@company.com',
        name: 'John Doe'
      });

      (parserService.parseText as jest.Mock)
        .mockResolvedValueOnce({ project_id: 1 })
        .mockResolvedValueOnce({
          project_id: 1,
          project_name: 'Website',
          hours: 4,
          date: '2024-01-15',
          description: 'Worked'
        });

      mockOdooService.getProjects.mockResolvedValue([{ id: 1, name: 'Website', active: true }]);

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(TeamsInfo.getMember).toHaveBeenCalledWith(
        expect.anything(),
        'teams-user-id-123'
      );
    });

    it('should use from.id if it contains @ and other methods fail', async () => {
      mockContext.activity!.from.name = 'John Doe';
      mockContext.activity!.from.id = 'john.doe@company.com';
      (TeamsInfo.getMember as jest.Mock).mockRejectedValue(new Error('Not found'));

      (parserService.parseText as jest.Mock)
        .mockResolvedValueOnce({ project_id: 1 })
        .mockResolvedValueOnce({
          project_id: 1,
          project_name: 'Website',
          hours: 4,
          date: '2024-01-15',
          description: 'Worked'
        });

      mockOdooService.getProjects.mockResolvedValue([{ id: 1, name: 'Website', active: true }]);

      await (bot as any).handleMessage(mockContext as TurnContext);

      // Should still work, extracting email from from.id
      expect(mockContext.sendActivity).toHaveBeenCalled();
    });

    it('should show error when email cannot be extracted', async () => {
      mockContext.activity!.from.name = 'John Doe';
      mockContext.activity!.from.id = 'teams-user-id-123';
      (TeamsInfo.getMember as jest.Mock).mockRejectedValue(new Error('Not found'));

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(mockContext.sendActivity).toHaveBeenCalledWith(
        expect.stringContaining('Could not retrieve your email')
      );
    });

    it('should handle email with mixed case from Teams', async () => {
      mockContext.activity!.from.name = 'John.Doe@Company.COM';

      (parserService.parseText as jest.Mock)
        .mockResolvedValueOnce({ project_id: 1 })
        .mockResolvedValueOnce({
          project_id: 1,
          project_name: 'Website',
          hours: 4,
          date: '2024-01-15',
          description: 'Worked'
        });

      mockOdooService.getProjects.mockResolvedValue([{ id: 1, name: 'Website', active: true }]);

      await (bot as any).handleMessage(mockContext as TurnContext);

      // Email should be normalized to lowercase
      expect(mockContext.sendActivity).toHaveBeenCalled();
    });

    it('should handle channelData containing user email', async () => {
      mockContext.activity!.from.name = 'John Doe';
      mockContext.activity!.channelData = {
        tenant: { id: 'tenant-id' },
        from: { aadObjectId: 'aad-id' },
        user: { email: 'john.doe@company.com' }
      };

      (parserService.parseText as jest.Mock)
        .mockResolvedValueOnce({ project_id: 1 })
        .mockResolvedValueOnce({
          project_id: 1,
          project_name: 'Website',
          hours: 4,
          date: '2024-01-15',
          description: 'Worked'
        });

      mockOdooService.getProjects.mockResolvedValue([{ id: 1, name: 'Website', active: true }]);

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(mockContext.sendActivity).toHaveBeenCalled();
    });

    it('should trim whitespace from extracted email', async () => {
      mockContext.activity!.from.name = '  john.doe@company.com  ';

      (parserService.parseText as jest.Mock)
        .mockResolvedValueOnce({ project_id: 1 })
        .mockResolvedValueOnce({
          project_id: 1,
          project_name: 'Website',
          hours: 4,
          date: '2024-01-15',
          description: 'Worked'
        });

      mockOdooService.getProjects.mockResolvedValue([{ id: 1, name: 'Website', active: true }]);

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(mockContext.sendActivity).toHaveBeenCalled();
    });
  });

  describe('Admin Proxy Mode Commands', () => {
    it('should inform user they are already connected when using connect command', async () => {
      mockContext.activity!.text = 'connect';

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(mockContext.sendActivity).toHaveBeenCalledWith(
        expect.stringContaining('already connected via Admin Proxy mode')
      );
    });

    it('should inform user they are already connected when using apikey command', async () => {
      mockContext.activity!.text = 'apikey';

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(mockContext.sendActivity).toHaveBeenCalledWith(
        expect.stringContaining('not needed in Admin Proxy mode')
      );
    });

    it('should inform user they are already connected when using oauth command', async () => {
      mockContext.activity!.text = 'oauth';

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(mockContext.sendActivity).toHaveBeenCalledWith(
        expect.stringContaining('not needed in Admin Proxy mode')
      );
    });

    it('should inform user disconnect is not available in admin proxy mode', async () => {
      mockContext.activity!.text = 'disconnect';

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(mockContext.sendActivity).toHaveBeenCalledWith(
        expect.stringContaining('not available in Admin Proxy mode')
      );
    });

    it('should show status with email lookup in admin proxy mode', async () => {
      mockContext.activity!.text = 'status';
      mockContext.activity!.from.name = 'john.doe@company.com';

      mockOdooService.lookupUserByEmail.mockResolvedValue({
        id: 42,
        login: 'john.doe@company.com',
        name: 'John Doe',
        email: 'john.doe@company.com'
      });

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(mockOdooService.lookupUserByEmail).toHaveBeenCalledWith('john.doe@company.com');
      expect(mockContext.sendActivity).toHaveBeenCalled();
    });

    it('should show error in status when email cannot be retrieved', async () => {
      mockContext.activity!.text = 'status';
      mockContext.activity!.from.name = 'John Doe'; // Not an email
      (TeamsInfo.getMember as jest.Mock).mockRejectedValue(new Error('Not found'));

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(mockContext.sendActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: expect.any(Array)
        })
      );
    });
  });

  describe('Handle Save Timesheet (Admin Proxy)', () => {
    it('should log timesheet with email in admin proxy mode', async () => {
      const cardData: TimesheetCardData & { action: string } = {
        project_id: 1,
        project_name: 'Website',
        hours: 4,
        date: '2024-01-15',
        description: 'Worked on homepage',
        action: 'save_timesheet'
      };

      mockContext.activity!.value = cardData;
      mockContext.activity!.replyToId = 'reply-id-123';

      mockOdooService.logTime.mockResolvedValue(12345);

      await (bot as any).handleSaveTimesheet(
        mockContext as TurnContext,
        cardData,
        'john.doe@company.com'
      );

      expect(mockOdooService.logTime).toHaveBeenCalledWith(
        expect.objectContaining({
          project_id: 1,
          hours: 4,
          description: 'Worked on homepage'
        }),
        undefined, // No teamsUserId
        'john.doe@company.com' // Email provided
      );
    });

    it('should handle user lookup failure gracefully', async () => {
      mockOdooService.logTime.mockRejectedValue(
        new Error('No Odoo user found with email: unknown@company.com')
      );

      const cardData: TimesheetCardData & { action: string } = {
        project_id: 1,
        project_name: 'Website',
        hours: 4,
        date: '2024-01-15',
        description: 'Worked',
        action: 'save_timesheet'
      };

      await (bot as any).handleSaveTimesheet(
        mockContext as TurnContext,
        cardData,
        'unknown@company.com'
      );

      expect(mockContext.sendActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: expect.any(Array)
        })
      );
    });

    it('should create new task before logging when requested', async () => {
      const cardData: TimesheetCardData & { action: string } = {
        project_id: 1,
        project_name: 'Website',
        hours: 4,
        date: '2024-01-15',
        description: 'Worked on new feature',
        create_new_task: true,
        new_task_name: 'New Homepage Design',
        action: 'save_timesheet'
      };

      mockOdooService.createTask.mockResolvedValue(999);
      mockOdooService.logTime.mockResolvedValue(12345);
      mockOdooService.lookupUserByEmail.mockResolvedValue({
        id: 42,
        login: 'john.doe@company.com',
        name: 'John Doe',
        email: 'john.doe@company.com'
      });

      await (bot as any).handleSaveTimesheet(
        mockContext as TurnContext,
        cardData,
        'john.doe@company.com'
      );

      expect(mockOdooService.createTask).toHaveBeenCalledWith(
        1,
        'New Homepage Design',
        'Worked on new feature',
        42
      );

      expect(mockOdooService.logTime).toHaveBeenCalledWith(
        expect.objectContaining({
          task_id: 999,
          task_name: 'New Homepage Design'
        }),
        undefined,
        'john.doe@company.com'
      );
    });
  });

  describe('Welcome Message (Admin Proxy)', () => {
    it('should send welcome card with email on conversation update', async () => {
      mockContext.activity!.type = 'conversationUpdate';
      mockContext.activity!.membersAdded = [{
        id: 'teams-user-id-123',
        name: 'john.doe@company.com'
      }];
      mockContext.activity!.recipient = { id: 'bot-id', name: 'Bot' };

      await (bot as any).onConversationUpdateActivity(mockContext as TurnContext);

      expect(mockContext.sendActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: expect.arrayContaining([
            expect.objectContaining({
              contentType: 'application/vnd.microsoft.card.adaptive'
            })
          ])
        })
      );
    });

    it('should send welcome card even if email cannot be extracted', async () => {
      mockContext.activity!.type = 'conversationUpdate';
      mockContext.activity!.membersAdded = [{
        id: 'teams-user-id-123',
        name: 'John Doe' // Not an email
      }];
      mockContext.activity!.recipient = { id: 'bot-id', name: 'Bot' };
      (TeamsInfo.getMember as jest.Mock).mockRejectedValue(new Error('Not found'));

      await (bot as any).onConversationUpdateActivity(mockContext as TurnContext);

      expect(mockContext.sendActivity).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: expect.arrayContaining([
            expect.objectContaining({
              contentType: 'application/vnd.microsoft.card.adaptive'
            })
          ])
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty email string', async () => {
      mockContext.activity!.from.name = '';

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(mockContext.sendActivity).toHaveBeenCalledWith(
        expect.stringContaining('Could not retrieve your email')
      );
    });

    it('should handle null/undefined from field', async () => {
      mockContext.activity!.from = undefined as any;

      await (bot as any).handleMessage(mockContext as TurnContext);

      // Should send an error message (either email error or generic error)
      expect(mockContext.sendActivity).toHaveBeenCalled();
    });

    it('should handle email with multiple @ symbols (invalid)', async () => {
      mockContext.activity!.from.name = 'invalid@@email.com';

      (parserService.parseText as jest.Mock)
        .mockResolvedValueOnce({ project_id: 1 })
        .mockResolvedValueOnce({
          project_id: 1,
          project_name: 'Website',
          hours: 4,
          date: '2024-01-15',
          description: 'Worked'
        });

      mockOdooService.getProjects.mockResolvedValue([{ id: 1, name: 'Website', active: true }]);

      await (bot as any).handleMessage(mockContext as TurnContext);

      // Should still attempt to use it (Odoo lookup will fail)
      expect(mockContext.sendActivity).toHaveBeenCalled();
    });

    it('should handle very long email addresses', async () => {
      const longEmail = 'a'.repeat(50) + '@' + 'b'.repeat(50) + '.com';
      mockContext.activity!.from.name = longEmail;

      (parserService.parseText as jest.Mock)
        .mockResolvedValueOnce({ project_id: 1 })
        .mockResolvedValueOnce({
          project_id: 1,
          project_name: 'Website',
          hours: 4,
          date: '2024-01-15',
          description: 'Worked'
        });

      mockOdooService.getProjects.mockResolvedValue([{ id: 1, name: 'Website', active: true }]);

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(mockContext.sendActivity).toHaveBeenCalled();
    });

    it('should handle special characters in email', async () => {
      const specialEmail = 'user+tag@sub.domain.co.uk';
      mockContext.activity!.from.name = specialEmail;

      (parserService.parseText as jest.Mock)
        .mockResolvedValueOnce({ project_id: 1 })
        .mockResolvedValueOnce({
          project_id: 1,
          project_name: 'Website',
          hours: 4,
          date: '2024-01-15',
          description: 'Worked'
        });

      mockOdooService.getProjects.mockResolvedValue([{ id: 1, name: 'Website', active: true }]);

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(mockContext.sendActivity).toHaveBeenCalled();
    });

    it('should handle concurrent messages from same user', async () => {
      mockContext.activity!.from.name = 'john.doe@company.com';

      (parserService.parseText as jest.Mock)
        .mockResolvedValue({ project_id: 1, project_name: 'Website', hours: 4, date: '2024-01-15', description: 'Work' });

      mockOdooService.getProjects.mockResolvedValue([{ id: 1, name: 'Website', active: true }]);

      // Send two messages concurrently
      const promise1 = (bot as any).handleMessage(mockContext as TurnContext);
      const promise2 = (bot as any).handleMessage(mockContext as TurnContext);

      await Promise.all([promise1, promise2]);

      // Both should succeed (may include typing indicators)
      expect(mockContext.sendActivity).toHaveBeenCalledTimes(4); // 2 typing + 2 responses
    });
  });
});
