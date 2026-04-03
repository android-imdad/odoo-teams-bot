import xmlrpc from 'xmlrpc';
import { config } from '../config/config';
import { logger } from '../config/logger';
import {
  OdooConfig,
  OdooProject,
  OdooTask
} from '../types/odoo.types';
import { TimesheetEntry, AuthRequiredError, AuthContext } from '../types';
import { Cache } from './cache';
import { OAuthService } from './oauth';
import { ApiKeyAuthService } from './apiKeyAuth';
import { UserMappingService, OdooUserInfo } from './userMapping';

/**
 * OdooService - XML-RPC client for Odoo ERP integration.
 *
 * ADMIN PROXY MODE - MINIMUM REQUIRED PERMISSIONS (E-1):
 * The admin service account used for admin_proxy mode should have ONLY these permissions:
 *
 * READ access:
 *   - project.project (list/read active projects)
 *   - project.task (list/read active tasks)
 *   - res.users (look up users by email for timesheet attribution)
 *
 * CREATE access:
 *   - account.analytic.line (create timesheet entries on behalf of users)
 *   - project.task (create new tasks when users request them)
 *
 * The service account should NOT have:
 *   - DELETE access to any model
 *   - WRITE access to res.users, project.project, or other sensitive models
 *   - Administration/Settings access
 *   - Access to accounting, HR, or other unrelated modules
 *
 * Recommended: Create a dedicated Odoo user with a custom access group
 * containing only the permissions listed above.
 */
class OdooService {
  private config: OdooConfig;
  private uid: number | null = null;
  private commonClient: xmlrpc.Client;
  private objectClient: xmlrpc.Client;
  private projectCache: Cache<OdooProject[]>;
  private oauthService?: OAuthService;
  private apiKeyAuthService?: ApiKeyAuthService;
  private userMappingService?: UserMappingService;
  private isAdminProxyMode: boolean;
  private timesheetBillabilityField?: 'billable' | null;

  constructor(
    odooConfig: OdooConfig,
    oauthService?: OAuthService,
    apiKeyAuthService?: ApiKeyAuthService,
    isAdminProxyMode: boolean = false
  ) {
    this.config = odooConfig;
    this.oauthService = oauthService;
    this.apiKeyAuthService = apiKeyAuthService;
    this.isAdminProxyMode = isAdminProxyMode;

    const url = new URL(odooConfig.url);
    const isSecure = url.protocol === 'https:';
    const port = parseInt(url.port || (isSecure ? '443' : '80'));

    const clientOptions = {
      host: url.hostname,
      port: port,
      path: '/xmlrpc/2/common'
    };

    const objectOptions = {
      host: url.hostname,
      port: port,
      path: '/xmlrpc/2/object'
    };

    this.commonClient = isSecure
      ? xmlrpc.createSecureClient(clientOptions)
      : xmlrpc.createClient(clientOptions);

    this.objectClient = isSecure
      ? xmlrpc.createSecureClient(objectOptions)
      : xmlrpc.createClient(objectOptions);

    this.projectCache = new Cache<OdooProject[]>();
    this.projectCache.startCleanup();

    // Initialize user mapping service for admin proxy mode
    if (isAdminProxyMode) {
      this.userMappingService = new UserMappingService(
        (model, method, params) => this.executeKw(model, method, params),
        config.cache.projectTtl
      );
    }

    logger.info('OdooService initialized', {
      url: odooConfig.url,
      oauthEnabled: !!oauthService,
      apiKeyAuthEnabled: !!apiKeyAuthService,
      adminProxyMode: isAdminProxyMode
    });
  }

  /**
   * Authenticate with Odoo and get user ID
   */
  private async authenticate(): Promise<number> {
    if (this.uid) {
      return this.uid;
    }

    return new Promise((resolve, reject) => {
      this.commonClient.methodCall(
        'authenticate',
        [
          this.config.db,
          this.config.username,
          this.config.password,
          {}
        ],
        (error: any, uid: number) => {
          if (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error('Odoo authentication failed', { error: errorMsg });
            reject(new Error(`Odoo authentication failed: ${errorMsg}`));
            return;
          }

          if (!uid) {
            logger.error('Odoo authentication failed: Invalid credentials');
            reject(new Error('Odoo authentication failed: Invalid credentials'));
            return;
          }

          this.uid = uid;
          logger.info('Odoo authentication successful', { uid });
          resolve(uid);
        }
      );
    });
  }

  /**
   * Execute Odoo object method
   */
  private async executeKw(
    model: string,
    method: string,
    params: any[]
  ): Promise<any> {
    const uid = await this.authenticate();

    return new Promise((resolve, reject) => {
      this.objectClient.methodCall(
        'execute_kw',
        [
          this.config.db,
          uid,
          this.config.password,
          model,
          method,
          params
        ],
        (error: any, result) => {
          if (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error('Odoo execute_kw failed', {
              model,
              method,
              error: errorMsg
            });
            reject(new Error(`Odoo ${model}.${method} failed: ${errorMsg}`));
            return;
          }

          resolve(result);
        }
      );
    });
  }


  /**
   * Detect which billability field is supported by account.analytic.line.
   * Only uses the standard 'billable' field (selection type in Odoo 13+).
   * Custom fields like 'x_is_billable' are avoided as they may be computed
   * fields without store=True that can't be written to directly.
   */
  private async getTimesheetBillabilityField(): Promise<'billable' | null> {
    if (this.timesheetBillabilityField !== undefined) {
      return this.timesheetBillabilityField;
    }

    try {
      const fieldMeta = await this.executeKw(
        'account.analytic.line',
        'fields_get',
        [[], ['type', 'selection']]
      );

      // Only use the standard 'billable' field - avoid custom x_ fields
      // as they may be computed and not actually writable
      if (fieldMeta?.billable?.type === 'selection') {
        this.timesheetBillabilityField = 'billable';
        logger.info('Detected supported timesheet billability field', { field: 'billable' });
        return this.timesheetBillabilityField;
      }

      // x_is_billable is a custom field that may exist in some Odoo installations
      // but is often a computed field that cannot be written to.
      // Skip it to avoid "Invalid field" errors during create.
      logger.info('Standard billable field not found; billability mapping disabled');
    } catch (error) {
      logger.warn('Failed to detect timesheet billability field; proceeding without billability mapping', { error });
    }

    this.timesheetBillabilityField = null;
    return this.timesheetBillabilityField;
  }
  /**
   * Get all active projects with caching
   */
  async getProjects(): Promise<OdooProject[]> {
    const cacheKey = 'active_projects';
    const cached = this.projectCache.get(cacheKey);

    if (cached) {
      logger.debug('Returning cached projects', { count: cached.length });
      return cached;
    }

    try {
      logger.info('Fetching projects from Odoo');

      // Search for active projects
      const projectIds = await this.executeKw(
        'project.project',
        'search',
        [[['active', '=', true]]]
      );

      if (!projectIds || projectIds.length === 0) {
        logger.warn('No active projects found in Odoo');
        return [];
      }

      // Try to read project details with code field (for standard Odoo installations)
      // Some Odoo versions (18+) don't have the 'code' field on project.project
      let projects: any[];
      try {
        projects = await this.executeKw(
          'project.project',
          'read',
          [projectIds, ['id', 'name', 'code', 'active']]
        );
      } catch (fieldError: any) {
        // The executeKw wrapper converts XML-RPC faults to plain Error objects,
        // so we need to check the error message string for the field name
        const errorMessage = String(fieldError.message || fieldError.faultString || fieldError);
        if (
          errorMessage.includes("Invalid field 'code'") ||
          errorMessage.includes("Invalid field") && errorMessage.includes("code") ||
          errorMessage.includes("KeyError: 'code'")
        ) {
          logger.info('Project "code" field not available on this Odoo version, fetching without it');
          projects = await this.executeKw(
            'project.project',
            'read',
            [projectIds, ['id', 'name', 'active']]
          );
        } else {
          throw fieldError;
        }
      }

      const mappedProjects: OdooProject[] = projects.map((p: any) => ({
        id: p.id,
        name: p.name,
        code: p.code || undefined,
        active: p.active
      }));

      // Cache the results
      this.projectCache.set(cacheKey, mappedProjects, config.cache.projectTtl);

      logger.info('Projects fetched and cached', { count: mappedProjects.length });
      return mappedProjects;

    } catch (error) {
      logger.error('Failed to fetch projects from Odoo', { error });
      throw error;
    }
  }

  /**
   * Get tasks for a specific project
   */
  async getTasks(projectId: number): Promise<OdooTask[]> {
    try {
      logger.info('Fetching tasks from Odoo', { projectId });

      // Search for active tasks in the project
      const taskIds = await this.executeKw(
        'project.task',
        'search',
        [[['project_id', '=', projectId], ['active', '=', true]]]
      );

      if (!taskIds || taskIds.length === 0) {
        logger.debug('No active tasks found for project', { projectId });
        return [];
      }

      // Read task details
      const tasks = await this.executeKw(
        'project.task',
        'read',
        [taskIds, ['id', 'name', 'project_id', 'active']]
      );

      const mappedTasks: OdooTask[] = tasks.map((t: any) => ({
        id: t.id,
        name: t.name,
        project_id: t.project_id[0],
        active: t.active
      }));

      logger.info('Tasks fetched successfully', { projectId, count: mappedTasks.length });
      return mappedTasks;

    } catch (error) {
      logger.error('Failed to fetch tasks from Odoo', { projectId, error });
      return []; // Return empty array on error to allow timesheet without task
    }
  }

  /**
   * Get authentication context for a specific user
   * Priority: API Key > OAuth > Service Account
   */
  private async getAuthForUser(teamsUserId: string): Promise<AuthContext> {
    // If API Key auth is enabled, try to get user's API key
    if (this.apiKeyAuthService) {
      const session = await this.apiKeyAuthService.getSession(teamsUserId);

      if (!session || !session.apiKey) {
        throw new AuthRequiredError('User not authenticated with Odoo. Please connect your account using "connect".');
      }

      return { type: 'api_key', apiKey: session.apiKey, uid: session.odooUserId };
    }

    // If OAuth is enabled, try to get user's access token
    if (this.oauthService) {
      const accessToken = await this.oauthService.getAccessToken(teamsUserId);

      if (!accessToken) {
        throw new AuthRequiredError('User not authenticated with Odoo. Please connect your account using "connect to odoo".');
      }

      return { type: 'oauth', accessToken };
    }

    // Legacy mode: use service account
    const uid = await this.authenticate();
    return { type: 'basic', uid };
  }

  /**
   * Execute Odoo method with per-user authentication
   */
  private async executeKwWithUserAuth(
    model: string,
    method: string,
    params: any[],
    auth: AuthContext
  ): Promise<any> {
    // For OAuth, we need to use JSON-RPC with Bearer token
    if (auth.type === 'oauth') {
      return this.executeKwWithOAuth(model, method, params, auth.accessToken!);
    }

    // For API Key auth, use XML-RPC with API key as password
    if (auth.type === 'api_key') {
      return this.executeKwWithApiKey(model, method, params, auth.uid!, auth.apiKey!);
    }

    // For basic auth, use XML-RPC
    return new Promise((resolve, reject) => {
      this.objectClient.methodCall(
        'execute_kw',
        [
          this.config.db,
          auth.uid,
          this.config.password,
          model,
          method,
          params
        ],
        (error: any, result) => {
          if (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error('Odoo execute_kw failed', {
              model,
              method,
              error: errorMsg
            });
            reject(new Error(`Odoo ${model}.${method} failed: ${errorMsg}`));
            return;
          }

          resolve(result);
        }
      );
    });
  }

  /**
   * Execute Odoo method using API Key authentication via XML-RPC
   * API Keys work by using the key as the password with the user ID
   */
  private async executeKwWithApiKey(
    model: string,
    method: string,
    params: any[],
    uid: number,
    apiKey: string
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      this.objectClient.methodCall(
        'execute_kw',
        [
          this.config.db,
          uid,
          apiKey, // Use API key as password
          model,
          method,
          params
        ],
        (error: any, result) => {
          if (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);

            // Check for authentication errors
            if (errorMsg.includes('Access denied') || errorMsg.includes('authentication')) {
              reject(new AuthRequiredError('API Key invalid or expired. Please reconnect your account.'));
              return;
            }

            logger.error('Odoo execute_kw with API Key failed', {
              model,
              method,
              error: errorMsg
            });
            reject(new Error(`Odoo ${model}.${method} failed: ${errorMsg}`));
            return;
          }

          resolve(result);
        }
      );
    });
  }

  /**
   * Execute Odoo method using OAuth Bearer token via JSON-RPC
   */
  private async executeKwWithOAuth(
    model: string,
    method: string,
    params: any[],
    accessToken: string
  ): Promise<any> {
    const url = new URL(this.config.url);
    const jsonRpcUrl = `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}/jsonrpc`;

    const body = {
      jsonrpc: '2.0',
      method: 'call',
      params: {
        service: 'object',
        method: 'execute_kw',
        args: [
          this.config.db,
          'oauth', // Special marker for OAuth
          accessToken, // Pass token as "password"
          model,
          method,
          params
        ]
      },
      id: Math.floor(Math.random() * 1000000000)
    };

    const response = await fetch(jsonRpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();

      // Check for authentication errors
      if (response.status === 401 || errorText.includes('session_invalid')) {
        throw new AuthRequiredError('Odoo session expired. Please reconnect your account.');
      }

      throw new Error(`Odoo ${model}.${method} failed: ${response.status} - ${errorText}`);
    }

    const data: any = await response.json();

    if (data.error) {
      // Check if it's an authentication error
      if (data.error.data?.name === 'odoo.exceptions.AccessDenied' ||
          data.error.message?.includes('Access denied')) {
        throw new AuthRequiredError('Odoo access denied. Please reconnect your account.');
      }

      throw new Error(`Odoo ${model}.${method} failed: ${data.error.message || JSON.stringify(data.error)}`);
    }

    return data.result;
  }

  /**
   * Create timesheet entry in Odoo with per-user authentication
   *
   * For admin_proxy mode: pass teamsUserEmail to look up and log as that user
   * For other modes: pass teamsUserId to use stored credentials
   */
  async logTime(
    entry: TimesheetEntry,
    teamsUserId?: string,
    teamsUserEmail?: string
  ): Promise<number> {
    try {
      logger.info('Creating timesheet entry in Odoo', { entry, teamsUserId, teamsUserEmail });

      // Admin proxy mode: use admin account but log as the user found by email
      if (this.isAdminProxyMode && teamsUserEmail) {
        return this.logTimeAsAdminProxy(entry, teamsUserEmail);
      }

      // Get authentication for the user (or service account if no user ID provided)
      let auth: AuthContext;
      let userId: number;

      if (teamsUserId) {
        auth = await this.getAuthForUser(teamsUserId);

        // For OAuth, we need to get the user's Odoo ID
        if (auth.type === 'oauth') {
          const session = await this.oauthService!.getUserSession(teamsUserId);
          userId = session?.odooUserId || 0;
        } else {
          userId = auth.uid!;
        }
      } else {
        // Fallback to service account
        userId = await this.authenticate();
        auth = { type: 'basic', uid: userId };
      }

      return this.createTimesheetEntry(entry, userId, auth);

    } catch (error) {
      logger.error('Failed to create timesheet entry', { entry, teamsUserId, teamsUserEmail, error });
      throw error;
    }
  }

  /**
   * Log timesheet using admin proxy mode
   * Looks up user by email and logs timesheet on their behalf
   */
  private async logTimeAsAdminProxy(entry: TimesheetEntry, userEmail: string): Promise<number> {
    logger.info('Logging timesheet via admin proxy', { projectId: entry.project_id, hours: entry.hours });

    // Look up the Odoo user by email
    const odooUser = await this.lookupUserByEmail(userEmail);

    if (!odooUser) {
      throw new Error(
        `No Odoo user found with email: ${userEmail}. ` +
        `Please ensure your Teams email matches your Odoo login email, ` +
        `or contact your administrator to set up your account.`
      );
    }

    // Admin authenticates with their own credentials
    const adminUid = await this.authenticate();
    const auth: AuthContext = { type: 'basic', uid: adminUid };

    // Use the found user's ID for the timesheet
    const userId = odooUser.id;

    logger.info('Admin proxy: logging timesheet for user', {
      adminUid,
      targetUserId: userId,
      targetUserEmail: userEmail,
      targetUserName: odooUser.name
    });

    return this.createTimesheetEntry(entry, userId, auth);
  }

  /**
   * Create the actual timesheet entry in Odoo
   */
  private async createTimesheetEntry(
    entry: TimesheetEntry,
    userId: number,
    auth: AuthContext
  ): Promise<number> {
    // Prepare timesheet data for Odoo 13-18
    // account.analytic.line is used for timesheets
    const timesheetParams: any = {
      project_id: entry.project_id,
      name: entry.description,
      unit_amount: entry.hours,
      date: entry.date,
      user_id: userId
    };

    // Include task_id if provided
    if (entry.task_id) {
      timesheetParams.task_id = entry.task_id;
    }

    // Include billability if explicitly set and supported by this Odoo instance.
    if (entry.billable !== undefined) {
      const billabilityField = await this.getTimesheetBillabilityField();

      if (billabilityField === 'billable') {
        timesheetParams.billable = entry.billable ? 'billable' : 'non_billable';
      } else {
        logger.warn('Billability requested but no supported writable field exists on account.analytic.line');
      }
    }

    // Create the timesheet entry with appropriate authentication
    const timesheetId = await this.executeKwWithUserAuth(
      'account.analytic.line',
      'create',
      [timesheetParams],
      auth
    );

    logger.info('Timesheet entry created successfully', {
      timesheetId,
      project_id: entry.project_id,
      task_id: entry.task_id,
      hours: entry.hours,
      userId,
      authType: auth.type
    });

    return timesheetId;
  }

  /**
   * Create a new task in Odoo
   */
  async createTask(projectId: number, taskName: string, description?: string, assigneeUserId?: number): Promise<number> {
    try {
      logger.info('Creating new task in Odoo', { projectId, taskName, assigneeUserId });

      const taskParams: any = {
        project_id: projectId,
        name: taskName,
        active: true
      };

      // Assign the task to the requesting user if provided.
      // Odoo 18+ uses user_ids (many2many); older versions use user_id (many2one).
      // If no assignee, explicitly clear to prevent Odoo auto-assigning the admin.
      if (assigneeUserId) {
        taskParams.user_ids = [[4, assigneeUserId, 0]];  // Command 4 = link
      } else {
        taskParams.user_ids = [[5, 0, 0]];  // Command 5 = unlink all
      }

      // Add description if provided
      if (description) {
        taskParams.description = description;
      }

      // Create the task, with fallback for Odoo versions that don't have user_ids
      let taskId: number;
      try {
        taskId = await this.executeKw(
          'project.task',
          'create',
          [taskParams]
        );
      } catch (firstError: any) {
        const errMsg = String(firstError.message || firstError);
        if (errMsg.includes("Invalid field 'user_ids'") || errMsg.includes("Invalid field") && errMsg.includes("user_ids")) {
          // Older Odoo without user_ids -- fall back to user_id (many2one)
          logger.info('user_ids not available, retrying task creation with user_id');
          delete taskParams.user_ids;
          taskParams.user_id = assigneeUserId || false;
          taskId = await this.executeKw(
            'project.task',
            'create',
            [taskParams]
          );
        } else {
          throw firstError;
        }
      }

      logger.info('Task created successfully', {
        taskId,
        projectId,
        taskName
      });

      return taskId;

    } catch (error) {
      logger.error('Failed to create task', { projectId, taskName, error });
      throw error;
    }
  }

  /**
   * Clear project cache manually
   */
  clearCache(): void {
    this.projectCache.clear();
    if (this.userMappingService) {
      this.userMappingService.clearAllCaches();
    }
    logger.info('Project cache cleared');
  }

  /**
   * Look up an Odoo user by their email address
   * Only available in admin proxy mode
   */
  async lookupUserByEmail(email: string): Promise<OdooUserInfo | null> {
    if (!this.isAdminProxyMode || !this.userMappingService) {
      throw new Error('User lookup is only available in admin proxy mode');
    }

    return this.userMappingService.lookupUserByEmail(email);
  }

  /**
   * Check if admin proxy mode is enabled
   */
  isAdminProxy(): boolean {
    return this.isAdminProxyMode;
  }
}

export { OdooService };
