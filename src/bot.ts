import {
  TeamsActivityHandler,
  TurnContext,
  TeamsInfo
} from 'botbuilder';
import { logger } from './config/logger';
import { config } from './config/config';
import { OdooService } from './services/odoo';
import { parserService } from './services/parser';
import { filterTasksByQuery } from './services/taskFilter';
import { TimesheetCardGenerator } from './cards/timesheetCard';
import { createAuthCard, createReauthCard, createConnectionStatusCard, buildAuthUrl, createApiKeyInputCard, createApiKeySuccessCard, createAuthOptionsCard } from './cards/authCard';
import { TimesheetCardData } from './types/bot.types';
import { TimesheetEntry, AuthRequiredError } from './types';
import { OAuthService } from './services/oauth';
import { ApiKeyAuthService } from './services/apiKeyAuth';

export class TimesheetBot extends TeamsActivityHandler {
  private oauthService?: OAuthService;
  private apiKeyAuthService?: ApiKeyAuthService;
  private odooService: OdooService;
  private useApiKeyAuth: boolean;
  private isAdminProxyMode: boolean;

  constructor(
    oauthService: OAuthService | undefined,
    apiKeyAuthService: ApiKeyAuthService | undefined,
    odooService: OdooService,
    useApiKeyAuth: boolean = false,
    isAdminProxyMode: boolean = false
  ) {
    super();
    this.oauthService = oauthService;
    this.apiKeyAuthService = apiKeyAuthService;
    this.odooService = odooService;
    this.useApiKeyAuth = useApiKeyAuth;
    this.isAdminProxyMode = isAdminProxyMode;

    // Handle incoming messages
    this.onMessage(async (context, next) => {
      await this.handleMessage(context);
      await next();
    });

    logger.info('TimesheetBot initialized', {
      oauthEnabled: !!oauthService,
      apiKeyAuthEnabled: !!apiKeyAuthService,
      useApiKeyAuth,
      isAdminProxyMode
    });
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
          const teamsUserId = member.id;

          // In admin proxy mode, no authentication needed - welcome the user directly
          if (this.isAdminProxyMode) {
            const teamsEmail = await this.extractTeamsEmail(context, teamsUserId);
            await context.sendActivity(
              `Welcome to the Odoo Timesheet Bot! 🎉\n\n` +
              `You're all set! Send a message like "Log 2 hours on Project X" to get started.` +
              (teamsEmail ? `\n\nYour timesheets will be logged for: ${teamsEmail}` : '')
            );
            logger.info('Welcome message sent (admin proxy mode)', { memberId: teamsUserId, email: teamsEmail });
            continue;
          }

          // Check if user is already authenticated (for non-admin-proxy modes)
          const isApiKeyAuth = this.apiKeyAuthService && await this.apiKeyAuthService.isAuthenticated(teamsUserId);
          const isOAuthAuth = this.oauthService && await this.oauthService.isAuthenticated(teamsUserId);
          const isAuthenticated = isApiKeyAuth || isOAuthAuth;

          if (!isAuthenticated) {
            // Show authentication options card for new users
            const authUrl = this.oauthService ? buildAuthUrl(config.bot.publicUrl, teamsUserId, context) : undefined;
            const optionsCard = createAuthOptionsCard(authUrl);

            await context.sendActivity({
              text: 'Welcome to the Odoo Timesheet Bot! 👋\n\nTo get started, please connect your Odoo account.',
              attachments: [optionsCard]
            });
            logger.info('Auth options card sent to new member', { memberId: teamsUserId });
          } else {
            // User is already authenticated, show welcome message
            await context.sendActivity(
              'Welcome back to the Odoo Timesheet Bot! 🎉\n\nYou\'re all set! Send a message like "Log 2 hours on Project X" to get started.'
            );
            logger.info('Welcome message sent to authenticated member', { memberId: teamsUserId });
          }
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
      const teamsUserId = context.activity.from.id;
      const teamsEmail = await this.extractTeamsEmail(context, teamsUserId);

      // Check if this is an adaptive card submit action
      const actionData = context.activity.value;
      if (actionData?.action === 'save_timesheet') {
        await this.handleSaveTimesheet(context, actionData as TimesheetCardData, teamsEmail);
        return;
      }
      if (actionData?.action === 'cancel_timesheet') {
        await this.handleCancelTimesheet(context, actionData as TimesheetCardData);
        return;
      }
      if (actionData?.action === 'disconnect_odoo') {
        await this.handleDisconnect(context);
        return;
      }
      if (actionData?.action === 'submit_api_key') {
        await this.handleApiKeySubmit(context, actionData);
        return;
      }
      if (actionData?.action === 'choose_api_key_auth') {
        await this.handleApiKeyConnect(context);
        return;
      }

      const userText = context.activity.text?.trim();

      if (!userText) {
        await context.sendActivity('Please provide a timesheet entry.');
        return;
      }

      logger.info('Processing message', {
        userId: teamsUserId,
        email: teamsEmail,
        text: userText,
        adminProxyMode: this.isAdminProxyMode
      });

      // Handle special commands
      const lowerText = userText.toLowerCase();

      // Handle connection status command
      if (lowerText === 'status' || lowerText === 'connection status') {
        await this.handleConnectionStatus(context, teamsEmail);
        return;
      }

      // Handle connect command (skip in admin proxy mode)
      if (lowerText === 'connect' || lowerText === 'connect to odoo' || lowerText === 'login') {
        if (this.isAdminProxyMode) {
          await context.sendActivity(
            '✅ You\'re already connected via Admin Proxy mode. ' +
            `Timesheets will be logged for: ${teamsEmail || 'your Teams email'}`
          );
          return;
        }
        await this.handleConnectCommand(context);
        return;
      }

      // Handle connect with apikey command (skip in admin proxy mode)
      if (lowerText === 'connect apikey' || lowerText === 'apikey') {
        if (this.isAdminProxyMode) {
          await context.sendActivity('API Key authentication is not needed in Admin Proxy mode.');
          return;
        }
        await this.handleApiKeyConnect(context);
        return;
      }

      // Handle connect with oauth command (skip in admin proxy mode)
      if (lowerText === 'connect oauth' || lowerText === 'oauth') {
        if (this.isAdminProxyMode) {
          await context.sendActivity('OAuth authentication is not needed in Admin Proxy mode.');
          return;
        }
        await this.handleOAuthConnect(context);
        return;
      }

      // Handle disconnect command (skip in admin proxy mode)
      if (lowerText === 'disconnect' || lowerText === 'logout') {
        if (this.isAdminProxyMode) {
          await context.sendActivity(
            'Disconnect is not available in Admin Proxy mode. ' +
            'Your account is automatically linked via your Teams email.'
          );
          return;
        }
        await this.handleDisconnect(context);
        return;
      }

      // Skip authentication check in admin proxy mode
      if (!this.isAdminProxyMode) {
        // Check if user is authenticated with either OAuth or API Key
        const isApiKeyAuth = this.apiKeyAuthService && await this.apiKeyAuthService.isAuthenticated(teamsUserId);
        const isOAuthAuth = this.oauthService && await this.oauthService.isAuthenticated(teamsUserId);
        const isAuthenticated = isApiKeyAuth || isOAuthAuth;

        if (!isAuthenticated) {
          // Show auth options if neither method is authenticated
          const authUrl = this.oauthService ? buildAuthUrl(config.bot.publicUrl, teamsUserId, context) : undefined;
          const optionsCard = createAuthOptionsCard(authUrl);
          await context.sendActivity({
            attachments: [optionsCard],
            text: 'Please connect your Odoo account to log timesheets.'
          });
          return;
        }
      }

      // Validate we have an email for admin proxy mode
      if (this.isAdminProxyMode && !teamsEmail) {
        await context.sendActivity(
          '❌ Could not retrieve your email from Teams. ' +
          'Please ensure your Teams profile has an email address configured.'
        );
        return;
      }

      // Send typing indicator
      await context.sendActivity({ type: 'typing' });

      // Fetch projects from Odoo
      const projects = await this.odooService.getProjects();

      if (projects.length === 0) {
        logger.error('No projects available in Odoo');
        await context.sendActivity(
          'Unable to fetch projects from Odoo. Please contact your administrator.'
        );
        return;
      }

      // First pass: parse to identify project
      const initialParse = await parserService.parseText(userText, projects);

      // If project identified, fetch and filter tasks for that project
      let tasks: any[] = [];
      if (initialParse.project_id) {
        const allTasks = await this.odooService.getTasks(initialParse.project_id);

        // Use Fuse.js to filter tasks based on user query - return top 5 matches
        tasks = filterTasksByQuery(allTasks, userText, { limit: 5 });

        logger.info('Tasks filtered for parsing', {
          totalTasks: allTasks.length,
          filteredTasks: tasks.length,
          projectId: initialParse.project_id
        });
      }

      // Second pass: parse with filtered tasks included
      const parsed = await parserService.parseText(userText, projects, tasks);

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
        task_id: parsed.task_id || undefined,
        task_name: parsed.task_name || undefined,
        create_new_task: parsed.create_new_task || undefined,
        new_task_name: parsed.new_task_name || undefined,
        hours: parsed.hours,
        date: parsed.date,
        description: parsed.description
      };

      const confirmCard = TimesheetCardGenerator.createConfirmationCard(cardData);
      await context.sendActivity({
        text: `Please confirm your timesheet:\n\nProject: ${cardData.project_name}\nTask: ${cardData.task_name || 'None'}\nHours: ${cardData.hours}\nDate: ${cardData.date}\nDescription: ${cardData.description}`,
        attachments: [confirmCard]
      });

      logger.info('Confirmation card sent', { cardData });

    } catch (error) {
      logger.error('Error handling message', { error });
      await context.sendActivity(
        'An error occurred while processing your request. Please try again later.'
      );
    }
  }

  /**
   * Extract Teams email from context
   * Tries multiple sources to get the user's email
   */
  private async extractTeamsEmail(context: TurnContext, teamsUserId: string): Promise<string | undefined> {
    try {
      // DEV/TEST MODE: Override email from environment variable
      // Use this for testing with Bot Framework Emulator
      if (process.env.TEST_USER_EMAIL) {
        return process.env.TEST_USER_EMAIL.toLowerCase().trim();
      }

      // Method 1: Try to get from activity.from (most common in Teams)
      const from = context.activity.from;
      if (from?.aadObjectId) {
        // In Teams, the email might be in the name field or we can get it from additional properties
        const name = from.name || '';

        // Check if the name looks like an email
        if (name.includes('@')) {
          return name.toLowerCase().trim();
        }
      }

      // Method 2: Check channelData for Teams-specific info
      const channelData = context.activity.channelData as any;
      if (channelData?.tenant?.id) {
        // We're in Teams context
        const teamsContext = channelData;

        // Try to get email from various places in Teams context
        const email =
          teamsContext?.from?.aadObjectId || // Sometimes this is the email
          teamsContext?.user?.email ||
          teamsContext?.message?.from?.user?.email;

        if (email && email.includes('@')) {
          return email.toLowerCase().trim();
        }
      }

      // Method 3: Try to use Bot Framework's getConversationMember
      // This requires the Teams-specific API
      try {
        const member = await TeamsInfo.getMember(context, teamsUserId);
        if (member?.email) {
          return member.email.toLowerCase().trim();
        }
      } catch (memberError) {
        logger.debug('Could not get member info via TeamsInfo', { error: memberError });
      }

      // Method 4: Check if from.id is an email
      if (teamsUserId && teamsUserId.includes('@')) {
        return teamsUserId.toLowerCase().trim();
      }

      logger.warn('Could not extract email from Teams context', {
        from: context.activity.from,
        channelData: context.activity.channelData
      });

      return undefined;

    } catch (error) {
      logger.error('Error extracting Teams email', { error, teamsUserId });
      return undefined;
    }
  }

  /**
   * Handle connection status command
   */
  private async handleConnectionStatus(context: TurnContext, teamsEmail?: string): Promise<void> {
    const teamsUserId = context.activity.from.id;

    // Admin proxy mode - show connection status based on email lookup
    if (this.isAdminProxyMode) {
      const email = teamsEmail || await this.extractTeamsEmail(context, teamsUserId);

      if (!email) {
        await context.sendActivity({
          attachments: [createConnectionStatusCard(false, undefined, undefined,
            '⚠️ Could not retrieve your Teams email. Please ensure your Teams profile has an email configured.')]
        });
        return;
      }

      // Check if user exists in Odoo
      try {
        const odooUser = await this.odooService.lookupUserByEmail(email);
        if (odooUser) {
          await context.sendActivity({
            attachments: [createConnectionStatusCard(
              true,
              `${odooUser.name} (${odooUser.login})`,
              undefined,
              '✅ Admin Proxy Mode: Your timesheets will be logged via the admin account.'
            )]
          });
        } else {
          await context.sendActivity({
            attachments: [createConnectionStatusCard(
              false,
              undefined,
              undefined,
              `⚠️ No Odoo user found with email: ${email}. Please contact your administrator.`
            )]
          });
        }
      } catch (error) {
        await context.sendActivity({
          attachments: [createConnectionStatusCard(
            false,
            undefined,
            undefined,
            '❌ Error looking up your Odoo account. Please try again later.'
          )]
        });
      }
      return;
    }

    // Handle API Key auth
    if (this.useApiKeyAuth && this.apiKeyAuthService) {
      const isAuthenticated = await this.apiKeyAuthService.isAuthenticated(teamsUserId);
      const session = isAuthenticated ? await this.apiKeyAuthService.getSession(teamsUserId) : null;

      await context.sendActivity({
        attachments: [createConnectionStatusCard(
          isAuthenticated,
          session?.odooUsername
        )]
      });
      return;
    }

    if (!this.oauthService) {
      await context.sendActivity({
        attachments: [createConnectionStatusCard(false, 'Service Account Mode')]
      });
      return;
    }

    const session = await this.oauthService.getUserSession(teamsUserId);
    const authUrl = buildAuthUrl(config.bot.publicUrl, teamsUserId, context);

    await context.sendActivity({
      attachments: [createConnectionStatusCard(
        !!session,
        session?.odooUsername,
        authUrl
      )]
    });
  }

  /**
   * Handle connect command - shows auth options
   */
  private async handleConnectCommand(context: TurnContext): Promise<void> {
    const teamsUserId = context.activity.from.id;

    // Check if already authenticated with either method
    const isApiKeyAuth = this.apiKeyAuthService && await this.apiKeyAuthService.isAuthenticated(teamsUserId);
    const isOAuthAuth = this.oauthService && await this.oauthService.isAuthenticated(teamsUserId);

    if (isApiKeyAuth) {
      const session = await this.apiKeyAuthService!.getSession(teamsUserId);
      await context.sendActivity(`You're already connected via API Key as ${session?.odooUsername}.`);
      return;
    }

    if (isOAuthAuth) {
      const session = await this.oauthService!.getUserSession(teamsUserId);
      await context.sendActivity(`You're already connected via OAuth as ${session?.odooUsername}.`);
      return;
    }

    // Show auth options card
    const authUrl = this.oauthService ? buildAuthUrl(config.bot.publicUrl, teamsUserId, context) : undefined;
    const optionsCard = createAuthOptionsCard(authUrl);
    await context.sendActivity({ attachments: [optionsCard] });
  }

  /**
   * Handle API Key connect flow
   */
  private async handleApiKeyConnect(context: TurnContext): Promise<void> {
    const teamsUserId = context.activity.from.id;

    if (!this.apiKeyAuthService) {
      await context.sendActivity('API Key authentication is not available.');
      return;
    }

    const isAuthenticated = await this.apiKeyAuthService.isAuthenticated(teamsUserId);
    if (isAuthenticated) {
      const session = await this.apiKeyAuthService.getSession(teamsUserId);
      await context.sendActivity(`You're already connected as ${session?.odooUsername}.`);
      return;
    }

    // Send API Key input card
    const apiKeyCard = createApiKeyInputCard();
    await context.sendActivity({ attachments: [apiKeyCard] });
  }

  /**
   * Handle OAuth connect flow
   */
  private async handleOAuthConnect(context: TurnContext): Promise<void> {
    const teamsUserId = context.activity.from.id;

    if (!this.oauthService) {
      await context.sendActivity('OAuth is not enabled. Please use API Key authentication instead.');
      return;
    }

    // Check if already connected
    const isAuthenticated = await this.oauthService.isAuthenticated(teamsUserId);
    if (isAuthenticated) {
      const session = await this.oauthService.getUserSession(teamsUserId);
      await context.sendActivity(`You're already connected as ${session?.odooUsername}.`);
      return;
    }

    // Send OAuth auth card
    const authUrl = buildAuthUrl(config.bot.publicUrl, teamsUserId, context);
    const authCard = createAuthCard({
      userId: teamsUserId,
      authUrl,
      title: 'Connect Your Odoo Account'
    });

    await context.sendActivity({ attachments: [authCard] });
  }

  /**
   * Handle API Key submission
   */
  private async handleApiKeySubmit(context: TurnContext, data: any): Promise<void> {
    const teamsUserId = context.activity.from.id;
    const { apiKey, odooUsername } = data;

    if (!apiKey || !odooUsername) {
      await context.sendActivity('Please provide both your Odoo username and API Key.');
      return;
    }

    try {
      // Validate the API key
      const validationResult = await this.apiKeyAuthService!.validateApiKey(
        apiKey,
        config.odoo.url,
        config.odoo.db,
        odooUsername
      );

      if (!validationResult.valid) {
        await context.sendActivity({
          attachments: [createApiKeyInputCard(`❌ Validation failed: ${validationResult.error}. Please check your credentials and try again.`)]
        });
        return;
      }

      // Store the API key
      await this.apiKeyAuthService!.storeApiKey(
        teamsUserId,
        odooUsername,
        validationResult.userId!,
        apiKey
      );

      // Send success message
      await context.sendActivity({
        attachments: [createApiKeySuccessCard(odooUsername)]
      });

      logger.info('User connected via API Key', { teamsUserId, odooUsername, odooUserId: validationResult.userId });
    } catch (error) {
      logger.error('Failed to validate API Key', { error, teamsUserId });
      await context.sendActivity({
        attachments: [createApiKeyInputCard('An error occurred while validating your API Key. Please try again.')]
      });
    }
  }

  /**
   * Handle disconnect command
   */
  private async handleDisconnect(context: TurnContext): Promise<void> {
    const teamsUserId = context.activity.from.id;

    // Handle API Key auth
    if (this.useApiKeyAuth && this.apiKeyAuthService) {
      try {
        await this.apiKeyAuthService.revokeAuth(teamsUserId);
        await context.sendActivity('You have been disconnected from Odoo. Use "connect" to reconnect.');
      } catch (error) {
        logger.error('Failed to disconnect user', { teamsUserId, error });
        await context.sendActivity('Failed to disconnect. Please try again.');
      }
      return;
    }

    if (!this.oauthService) {
      await context.sendActivity('OAuth is not enabled.');
      return;
    }

    try {
      await this.oauthService.revokeAuth(teamsUserId);
      await context.sendActivity('You have been disconnected from Odoo. Use "connect" to reconnect.');
    } catch (error) {
      logger.error('Failed to disconnect user', { teamsUserId, error });
      await context.sendActivity('Failed to disconnect. Please try again.');
    }
  }

  /**
   * Handle timesheet save confirmation
   */
  private async handleSaveTimesheet(
    context: TurnContext,
    data: TimesheetCardData,
    teamsEmail?: string
  ): Promise<void> {
    const teamsUserId = context.activity.from.id;

    try {
      logger.info('Saving timesheet to Odoo', { data, teamsUserId, teamsEmail });

      let taskId = data.task_id;
      let taskName = data.task_name;

      // Create new task if requested
      if (data.create_new_task && data.new_task_name) {
        logger.info('Creating new task before logging time', {
          projectId: data.project_id,
          taskName: data.new_task_name
        });

        try {
          const newTaskId = await this.odooService.createTask(
            data.project_id,
            data.new_task_name,
            data.description
          );

          taskId = newTaskId;
          taskName = data.new_task_name;

          logger.info('New task created successfully', {
            taskId: newTaskId,
            taskName: data.new_task_name
          });
        } catch (taskError) {
          logger.error('Failed to create new task', { taskError, data });
          await context.sendActivity({
            attachments: [TimesheetCardGenerator.createErrorCard(
              'Failed to create the new task in Odoo. The timesheet will be logged without a task.'
            )]
          });
          // Continue without task - taskId remains undefined
        }
      }

      // Create timesheet entry
      const entry: TimesheetEntry = {
        project_id: data.project_id,
        project_name: data.project_name,
        task_id: taskId,
        task_name: taskName,
        hours: data.hours,
        date: data.date,
        description: data.description
      };

      // Create timesheet in Odoo
      // For admin proxy mode, pass the email; otherwise pass the userId
      let timesheetId: number;
      if (this.isAdminProxyMode && teamsEmail) {
        timesheetId = await this.odooService.logTime(entry, undefined, teamsEmail);
      } else {
        timesheetId = await this.odooService.logTime(entry, teamsUserId);
      }

      logger.info('Timesheet saved successfully', {
        timesheetId,
        userId: teamsUserId,
        email: teamsEmail
      });

      // Update data with the new task info for the confirmed card
      const confirmedData: TimesheetCardData = {
        ...data,
        task_id: taskId,
        task_name: taskName
      };

      // Update the original card to show confirmed state (removes buttons)
      const confirmedCard = TimesheetCardGenerator.createConfirmedCard(confirmedData);
      await context.updateActivity({
        id: context.activity.replyToId || context.activity.id,
        attachments: [confirmedCard],
        type: 'message'
      });

      logger.info('Confirmation card updated');

    } catch (error) {
      logger.error('Failed to save timesheet', { error, data, teamsUserId, teamsEmail });

      // Handle authentication errors specifically (not applicable for admin proxy)
      if (!this.isAdminProxyMode && error instanceof AuthRequiredError) {
        const authUrl = buildAuthUrl(config.bot.publicUrl, teamsUserId, context);
        const reauthCard = createReauthCard(authUrl);
        await context.sendActivity({
          text: error.message,
          attachments: [reauthCard]
        });
        return;
      }

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
