/**
 * Tests for TimesheetBot
 */

import { TimesheetBot } from '../src/bot';
import { odooService } from '../src/services/odoo';
import { parserService } from '../src/services/parser';
import { TimesheetCardGenerator } from '../src/cards/timesheetCard';
import { logger } from '../src/config/logger';
import { TurnContext, Activity, ChannelAccount } from 'botbuilder';
import { TimesheetCardData } from '../src/types/bot.types';

jest.mock('../src/services/odoo');
jest.mock('../src/services/parser');
jest.mock('../src/cards/timesheetCard');
jest.mock('../src/config/logger');

describe('TimesheetBot', () => {
  let bot: TimesheetBot;
  let mockContext: Partial<TurnContext>;
  let sendActivityMock: jest.Mock;
  let updateActivityMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    bot = new TimesheetBot();

    sendActivityMock = jest.fn().mockResolvedValue(undefined);
    updateActivityMock = jest.fn().mockResolvedValue(undefined);

    mockContext = {
      activity: {
        type: 'message',
        text: 'Log 2 hours on Project X',
        from: { id: 'user-1', name: 'Test User' },
        recipient: { id: 'bot-1', name: 'Bot' },
        channelId: 'msteams',
        conversation: { id: 'conv-1' },
        id: 'activity-1',
        replyToId: 'reply-1',
        timestamp: new Date(),
        localTimestamp: new Date(),
      } as Activity,
      sendActivity: sendActivityMock,
      updateActivity: updateActivityMock,
    };
  });

  describe('constructor', () => {
    it('should initialize the bot', () => {
      expect(bot).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith('TimesheetBot initialized');
    });
  });

  describe('onConversationUpdateActivity', () => {
    it('should send welcome message when member added', async () => {
      const context = {
        ...mockContext,
        activity: {
          ...mockContext.activity,
          type: 'conversationUpdate',
          membersAdded: [
            { id: 'user-2', name: 'New User' }
          ],
          recipient: { id: 'bot-1', name: 'Bot' },
        } as Activity,
      } as TurnContext;

      // Access protected method
      await (bot as any).onConversationUpdateActivity(context);

      expect(sendActivityMock).toHaveBeenCalledWith(
        'Welcome to the Odoo Timesheet Bot! Send a message like "Log 2 hours on Project X" to get started.'
      );
      expect(logger.info).toHaveBeenCalledWith(
        'Welcome message sent to new member',
        { memberId: 'user-2' }
      );
    });

    it('should not send welcome to bot itself', async () => {
      const context = {
        ...mockContext,
        activity: {
          ...mockContext.activity,
          type: 'conversationUpdate',
          membersAdded: [
            { id: 'bot-1', name: 'Bot' }
          ],
          recipient: { id: 'bot-1', name: 'Bot' },
        } as Activity,
      } as TurnContext;

      await (bot as any).onConversationUpdateActivity(context);

      expect(sendActivityMock).not.toHaveBeenCalled();
    });

    it('should handle no members added', async () => {
      const context = {
        ...mockContext,
        activity: {
          ...mockContext.activity,
          type: 'conversationUpdate',
          membersAdded: [],
        } as Activity,
      } as TurnContext;

      await (bot as any).onConversationUpdateActivity(context);

      expect(sendActivityMock).not.toHaveBeenCalled();
    });
  });

  describe('handleMessage', () => {
    it('should handle save_timesheet action', async () => {
      const context = {
        ...mockContext,
        activity: {
          ...mockContext.activity,
          value: {
            action: 'save_timesheet',
            project_id: 1,
            project_name: 'Test Project',
            hours: 2,
            date: '2024-01-15',
            description: 'Test work'
          },
        } as Activity,
      } as TurnContext;

      (TimesheetCardGenerator.createConfirmedCard as jest.Mock).mockReturnValue({
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: { type: 'AdaptiveCard', version: '1.3' }
      });

      (odooService.logTime as jest.Mock).mockResolvedValue(123);

      await (bot as any).handleMessage(context);

      expect(odooService.logTime).toHaveBeenCalled();
      expect(updateActivityMock).toHaveBeenCalled();
    });

    it('should handle cancel_timesheet action', async () => {
      const context = {
        ...mockContext,
        activity: {
          ...mockContext.activity,
          value: {
            action: 'cancel_timesheet',
            project_id: 1,
            project_name: 'Test Project',
            hours: 2,
            date: '2024-01-15',
            description: 'Test work'
          },
        } as Activity,
      } as TurnContext;

      (TimesheetCardGenerator.createCancelledStateCard as jest.Mock).mockReturnValue({
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: { type: 'AdaptiveCard', version: '1.3' }
      });

      await (bot as any).handleMessage(context);

      expect(logger.info).toHaveBeenCalledWith(
        'Timesheet cancelled by user',
        { userId: 'user-1' }
      );
      expect(updateActivityMock).toHaveBeenCalled();
    });

    it('should handle empty message', async () => {
      const context = {
        ...mockContext,
        activity: {
          ...mockContext.activity,
          text: '   ',
        } as Activity,
      } as TurnContext;

      await (bot as any).handleMessage(context);

      expect(sendActivityMock).toHaveBeenCalledWith('Please provide a timesheet entry.');
    });

    it('should handle undefined message text', async () => {
      const context = {
        ...mockContext,
        activity: {
          ...mockContext.activity,
          text: undefined,
        } as Activity,
      } as TurnContext;

      await (bot as any).handleMessage(context);

      expect(sendActivityMock).toHaveBeenCalledWith('Please provide a timesheet entry.');
    });

    it('should send typing indicator', async () => {
      (odooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1, name: 'Project X' }]);
      (parserService.parseText as jest.Mock).mockResolvedValue({
        project_id: 1,
        project_name: 'Project X',
        hours: 2,
        date: '2024-01-15',
        description: 'Test work'
      });

      (TimesheetCardGenerator.createConfirmationCard as jest.Mock).mockReturnValue({
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: { type: 'AdaptiveCard', version: '1.3' }
      });

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(sendActivityMock).toHaveBeenCalledWith({ type: 'typing' });
    });

    it('should handle no projects available', async () => {
      (odooService.getProjects as jest.Mock).mockResolvedValue([]);

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(sendActivityMock).toHaveBeenCalledWith(
        'Unable to fetch projects from Odoo. Please contact your administrator.'
      );
    });

    it('should handle parsing with tasks', async () => {
      (odooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1, name: 'Project X' }]);
      (odooService.getTasks as jest.Mock).mockResolvedValue([{ id: 1, name: 'Task A' }]);
      (parserService.parseText as jest.Mock)
        .mockResolvedValueOnce({ project_id: 1, project_name: 'Project X' })
        .mockResolvedValueOnce({
          project_id: 1,
          project_name: 'Project X',
          task_id: 1,
          task_name: 'Task A',
          hours: 2,
          date: '2024-01-15',
          description: 'Test work'
        });

      (TimesheetCardGenerator.createConfirmationCard as jest.Mock).mockReturnValue({
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: { type: 'AdaptiveCard', version: '1.3' }
      });

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(odooService.getTasks).toHaveBeenCalledWith(1);
      expect(parserService.parseText).toHaveBeenCalledTimes(2);
    });

    it('should show error card when parsing fails', async () => {
      (odooService.getProjects as jest.Mock).mockResolvedValue([{ id: 1, name: 'Project X' }]);
      (parserService.parseText as jest.Mock).mockResolvedValue({
        error: 'Could not parse',
        project_id: null,
        hours: null,
        date: null
      });

      (TimesheetCardGenerator.createErrorCard as jest.Mock).mockReturnValue({
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: { type: 'AdaptiveCard', version: '1.3' }
      });

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(TimesheetCardGenerator.createErrorCard).toHaveBeenCalled();
      expect(sendActivityMock).toHaveBeenCalledWith({
        attachments: [expect.any(Object)]
      });
    });

    it('should handle general errors', async () => {
      (odooService.getProjects as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      await (bot as any).handleMessage(mockContext as TurnContext);

      expect(logger.error).toHaveBeenCalledWith(
        'Error handling message',
        { error: expect.anything() }
      );
      expect(sendActivityMock).toHaveBeenCalledWith(
        'An error occurred while processing your request. Please try again later.'
      );
    });
  });

  describe('handleSaveTimesheet', () => {
    const mockCardData: TimesheetCardData = {
      project_id: 1,
      project_name: 'Test Project',
      hours: 2,
      date: '2024-01-15',
      description: 'Test work'
    };

    it('should save timesheet successfully', async () => {
      (odooService.logTime as jest.Mock).mockResolvedValue(123);
      (TimesheetCardGenerator.createConfirmedCard as jest.Mock).mockReturnValue({
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: { type: 'AdaptiveCard', version: '1.3' }
      });

      await (bot as any).handleSaveTimesheet(mockContext as TurnContext, mockCardData);

      expect(odooService.logTime).toHaveBeenCalledWith(expect.objectContaining({
        project_id: 1,
        project_name: 'Test Project',
        hours: 2,
        date: '2024-01-15',
        description: 'Test work'
      }));
      expect(updateActivityMock).toHaveBeenCalled();
    });

    it('should create new task when requested', async () => {
      const cardDataWithNewTask: TimesheetCardData = {
        ...mockCardData,
        create_new_task: true,
        new_task_name: 'New Task'
      };

      (odooService.createTask as jest.Mock).mockResolvedValue(5);
      (odooService.logTime as jest.Mock).mockResolvedValue(123);
      (TimesheetCardGenerator.createConfirmedCard as jest.Mock).mockReturnValue({
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: { type: 'AdaptiveCard', version: '1.3' }
      });

      await (bot as any).handleSaveTimesheet(mockContext as TurnContext, cardDataWithNewTask);

      expect(odooService.createTask).toHaveBeenCalledWith(
        1,
        'New Task',
        'Test work'
      );
      expect(odooService.logTime).toHaveBeenCalledWith(expect.objectContaining({
        task_id: 5,
        task_name: 'New Task'
      }));
    });

    it('should handle task creation failure gracefully', async () => {
      const cardDataWithNewTask: TimesheetCardData = {
        ...mockCardData,
        create_new_task: true,
        new_task_name: 'New Task'
      };

      (odooService.createTask as jest.Mock).mockRejectedValue(new Error('Create failed'));
      (odooService.logTime as jest.Mock).mockResolvedValue(123);
      (TimesheetCardGenerator.createErrorCard as jest.Mock).mockReturnValue({
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: { type: 'AdaptiveCard', version: '1.3' }
      });

      await (bot as any).handleSaveTimesheet(mockContext as TurnContext, cardDataWithNewTask);

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to create new task',
        expect.any(Object)
      );
      expect(sendActivityMock).toHaveBeenCalled();
      expect(odooService.logTime).toHaveBeenCalledWith(expect.objectContaining({
        task_id: undefined,
        task_name: undefined
      }));
    });

    it('should handle save errors', async () => {
      (odooService.logTime as jest.Mock).mockRejectedValue(new Error('Save failed'));
      (TimesheetCardGenerator.createErrorCard as jest.Mock).mockReturnValue({
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: { type: 'AdaptiveCard', version: '1.3' }
      });

      await (bot as any).handleSaveTimesheet(mockContext as TurnContext, mockCardData);

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to save timesheet',
        expect.any(Object)
      );
      expect(sendActivityMock).toHaveBeenCalledWith({
        attachments: [expect.any(Object)]
      });
    });
  });

  describe('handleCancelTimesheet', () => {
    it('should cancel timesheet and update card', async () => {
      const cardData: TimesheetCardData = {
        project_id: 1,
        project_name: 'Test Project',
        hours: 2,
        date: '2024-01-15',
        description: 'Test work'
      };

      (TimesheetCardGenerator.createCancelledStateCard as jest.Mock).mockReturnValue({
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: { type: 'AdaptiveCard', version: '1.3' }
      });

      await (bot as any).handleCancelTimesheet(mockContext as TurnContext, cardData);

      expect(logger.info).toHaveBeenCalledWith(
        'Timesheet cancelled by user',
        { userId: 'user-1' }
      );
      expect(updateActivityMock).toHaveBeenCalledWith({
        id: 'reply-1',
        attachments: [expect.any(Object)],
        type: 'message'
      });
    });
  });

  describe('buildErrorMessage', () => {
    it('should build message for missing project', () => {
      const result = (bot as any).buildErrorMessage({
        project_id: null,
        hours: 2,
        date: '2024-01-15'
      });

      expect(result).toContain('Could not identify the project');
    });

    it('should build message for missing hours', () => {
      const result = (bot as any).buildErrorMessage({
        project_id: 1,
        hours: null,
        date: '2024-01-15'
      });

      expect(result).toContain('Could not extract hours worked');
    });

    it('should build message for missing date', () => {
      const result = (bot as any).buildErrorMessage({
        project_id: 1,
        hours: 2,
        date: null
      });

      expect(result).toContain('Could not determine the date');
    });

    it('should build message for multiple issues', () => {
      const result = (bot as any).buildErrorMessage({
        project_id: null,
        hours: null,
        date: null
      });

      expect(result).toContain('Could not identify the project');
      expect(result).toContain('Could not extract hours worked');
      expect(result).toContain('Could not determine the date');
    });

    it('should include error message if provided', () => {
      const result = (bot as any).buildErrorMessage({
        project_id: null,
        hours: null,
        date: null,
        error: 'Additional context'
      });

      expect(result).toContain('Additional context');
    });
  });
});
