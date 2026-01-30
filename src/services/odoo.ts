import xmlrpc from 'xmlrpc';
import { config } from '../config/config';
import { logger } from '../config/logger';
import {
  OdooConfig,
  OdooProject,
  OdooTask
} from '../types/odoo.types';
import { TimesheetEntry } from '../types';
import { Cache } from './cache';

export class OdooService {
  private config: OdooConfig;
  private uid: number | null = null;
  private commonClient: xmlrpc.Client;
  private objectClient: xmlrpc.Client;
  private projectCache: Cache<OdooProject[]>;

  constructor(odooConfig: OdooConfig) {
    this.config = odooConfig;

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

    logger.info('OdooService initialized', { url: odooConfig.url });
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
      let projects: any[];
      try {
        projects = await this.executeKw(
          'project.project',
          'read',
          [projectIds, ['id', 'name', 'code', 'active']]
        );
      } catch (fieldError) {
        // If 'code' field doesn't exist (Odoo Online trial), try without it
        logger.debug('Project "code" field not available, fetching without it');
        projects = await this.executeKw(
          'project.project',
          'read',
          [projectIds, ['id', 'name', 'active']]
        );
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
   * Create timesheet entry in Odoo
   */
  async logTime(entry: TimesheetEntry): Promise<number> {
    try {
      logger.info('Creating timesheet entry in Odoo', { entry });

      const uid = await this.authenticate();

      // Prepare timesheet data for Odoo 13-15
      // account.analytic.line is used for timesheets
      const timesheetParams: any = {
        project_id: entry.project_id,
        name: entry.description,
        unit_amount: entry.hours,
        date: entry.date,
        user_id: entry.user_id || uid
      };

      // Include task_id if provided
      if (entry.task_id) {
        timesheetParams.task_id = entry.task_id;
      }

      // Create the timesheet entry
      const timesheetId = await this.executeKw(
        'account.analytic.line',
        'create',
        [timesheetParams]
      );

      logger.info('Timesheet entry created successfully', {
        timesheetId,
        project_id: entry.project_id,
        task_id: entry.task_id,
        hours: entry.hours
      });

      return timesheetId;

    } catch (error) {
      logger.error('Failed to create timesheet entry', { entry, error });
      throw error;
    }
  }

  /**
   * Create a new task in Odoo
   */
  async createTask(projectId: number, taskName: string, description?: string): Promise<number> {
    try {
      logger.info('Creating new task in Odoo', { projectId, taskName });

      // Prepare task data
      const taskParams: any = {
        project_id: projectId,
        name: taskName,
        active: true
      };

      // Add description if provided
      if (description) {
        taskParams.description = description;
      }

      // Create the task
      const taskId = await this.executeKw(
        'project.task',
        'create',
        [taskParams]
      );

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
    logger.info('Project cache cleared');
  }
}

// Export singleton instance
export const odooService = new OdooService(config.odoo);
