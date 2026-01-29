import {
  TeamsActivityHandler,
  TurnContext
} from 'botbuilder';
import { logger } from './config/logger';
import { odooService } from './services/odoo';
import { parserService } from './services/parser';
import { TimesheetCardGenerator } from './cards/timesheetCard';
import { TimesheetCardData } from './types/bot.types';
import { TimesheetEntry } from './types';

export class TimesheetBot extends TeamsActivityHandler {
  constructor() {
    super();

    // Handle incoming messages
    this.onMessage(async (context, next) => {
      await this.handleMessage(context);
      await next();
    });

    logger.info('TimesheetBot initialized');
  }

  /**
   * Override onConversationUpdateActivity to handle conversation updates
   */
  protected override async onConversationUpdateActivity(context: TurnContext): Promise<void> {
    // Send welcome message for new conversations
    const membersAdded = context.activity.membersAdded;
    if (membersAdded && membersAdded.length > 0) {
      for (const member of membersAdded) {
        if (member.id !== context.activity.recipient?.id) {
          await context.sendActivity(
            'Welcome to the Odoo Timesheet Bot! Send a message like "Log 2 hours on Project X" to get started.'
          );
          logger.info('Welcome message sent to new member', { memberId: member.id });
        }
      }
    }
    await super.onConversationUpdateActivity(context);
  }

  /**
   * Handle incoming message from user
   */
  private async handleMessage(context: TurnContext): Promise<void> {
    try {
      // Check if this is an adaptive card submit action
      const actionData = context.activity.value;
      if (actionData?.action === 'save_timesheet') {
        await this.handleSaveTimesheet(context, actionData as TimesheetCardData);
        return;
      }
      if (actionData?.action === 'cancel_timesheet') {
        await this.handleCancelTimesheet(context, actionData as TimesheetCardData);
        return;
      }

      const userText = context.activity.text?.trim();

      if (!userText) {
        await context.sendActivity('Please provide a timesheet entry.');
        return;
      }

      logger.info('Processing message', {
        userId: context.activity.from.id,
        text: userText
      });

      // Send typing indicator
      await context.sendActivity({ type: 'typing' });

      // Fetch projects from Odoo
      const projects = await odooService.getProjects();

      if (projects.length === 0) {
        logger.error('No projects available in Odoo');
        await context.sendActivity(
          'Unable to fetch projects from Odoo. Please contact your administrator.'
        );
        return;
      }

      // Parse the timesheet text using Gemini
      const parsed = await parserService.parseText(userText, projects);

      // Check if parsing was successful
      if (parsed.error || !parsed.project_id || !parsed.hours || !parsed.date) {
        const errorMsg = this.buildErrorMessage(parsed);
        const errorCard = TimesheetCardGenerator.createErrorCard(errorMsg, userText);
        await context.sendActivity({ attachments: [errorCard] });
        return;
      }

      // Create confirmation card
      const cardData: TimesheetCardData = {
        project_id: parsed.project_id,
        project_name: parsed.project_name!,
        hours: parsed.hours,
        date: parsed.date,
        description: parsed.description
      };

      const confirmCard = TimesheetCardGenerator.createConfirmationCard(cardData);
      await context.sendActivity({ attachments: [confirmCard] });

      logger.info('Confirmation card sent', { cardData });

    } catch (error) {
      logger.error('Error handling message', { error });
      await context.sendActivity(
        'An error occurred while processing your request. Please try again later.'
      );
    }
  }

  /**
   * Handle timesheet save confirmation
   */
  private async handleSaveTimesheet(
    context: TurnContext,
    data: TimesheetCardData
  ): Promise<void> {
    try {
      logger.info('Saving timesheet to Odoo', { data });

      // Create timesheet entry
      const entry: TimesheetEntry = {
        project_id: data.project_id,
        project_name: data.project_name,
        hours: data.hours,
        date: data.date,
        description: data.description
      };

      // Create timesheet in Odoo
      const timesheetId = await odooService.logTime(entry);

      logger.info('Timesheet saved successfully', {
        timesheetId,
        userId: context.activity.from.id
      });

      // Update the original card to show confirmed state (removes buttons)
      const confirmedCard = TimesheetCardGenerator.createConfirmedCard(data);
      await context.updateActivity({
        id: context.activity.replyToId || context.activity.id,
        attachments: [confirmedCard],
        type: 'message'
      });

      logger.info('Confirmation card updated');

    } catch (error) {
      logger.error('Failed to save timesheet', { error, data });

      const errorCard = TimesheetCardGenerator.createErrorCard(
        'Failed to save timesheet to Odoo. Please try again or contact your administrator.'
      );
      await context.sendActivity({ attachments: [errorCard] });
    }
  }

  /**
   * Handle timesheet cancellation
   */
  private async handleCancelTimesheet(context: TurnContext, data: TimesheetCardData): Promise<void> {
    logger.info('Timesheet cancelled by user', {
      userId: context.activity.from.id
    });

    // Update the original card to show cancelled state (removes buttons)
    const cancelledCard = TimesheetCardGenerator.createCancelledStateCard(data);
    await context.updateActivity({
      id: context.activity.replyToId || context.activity.id,
      attachments: [cancelledCard],
      type: 'message'
    });

    logger.info('Cancellation card updated');
  }

  /**
   * Build error message from parsed data
   */
  private buildErrorMessage(parsed: any): string {
    const issues: string[] = [];

    if (!parsed.project_id) {
      issues.push('Could not identify the project');
    }
    if (!parsed.hours) {
      issues.push('Could not extract hours worked');
    }
    if (!parsed.date) {
      issues.push('Could not determine the date');
    }

    const baseMsg = issues.join(', ') + '.';
    return parsed.error ? `${baseMsg} ${parsed.error}` : baseMsg;
  }

}
