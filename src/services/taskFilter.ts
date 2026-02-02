import Fuse, { IFuseOptions, FuseOptionKey } from 'fuse.js';
import { OdooTask } from '../types/odoo.types';
import { logger } from '../config/logger';

export interface TaskFilterOptions {
  /** Number of top results to return (default: 5) */
  limit?: number;
  /** Minimum match score threshold (0-1, lower is better match) */
  threshold?: number;
  /** Keys to search in task objects */
  keys?: string[];
}

/**
 * Filter tasks using fuzzy text matching based on user query
 * Returns the top N most relevant tasks
 */
export function filterTasksByQuery(
  tasks: OdooTask[],
  query: string,
  options: TaskFilterOptions = {}
): OdooTask[] {
  const {
    limit = 5,
    threshold = 0.6,
    keys = ['name']
  } = options;

  if (!tasks || tasks.length === 0) {
    return [];
  }

  // If we have few tasks, return them all (no need to filter)
  if (tasks.length <= limit) {
    logger.debug('Task count below limit, returning all tasks', {
      taskCount: tasks.length,
      limit
    });
    return tasks;
  }

  try {
    // Configure Fuse.js options
    const fuseOptions: IFuseOptions<OdooTask> = {
      keys: keys as FuseOptionKey<OdooTask>[],
      threshold: threshold,
      includeScore: true,
      minMatchCharLength: 2,
      ignoreLocation: true, // Match anywhere in the string
      shouldSort: true,
      findAllMatches: false
    };

    // Create Fuse instance
    const fuse = new Fuse(tasks, fuseOptions);

    // Search for matches
    const results = fuse.search(query, { limit });

    logger.info('Task filtering completed', {
      query,
      totalTasks: tasks.length,
      matchedTasks: results.length,
      topMatches: results.slice(0, 3).map(r => ({
        name: r.item.name,
        score: r.score
      }))
    });

    // Extract just the task objects from results
    return results.map(result => result.item);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Task filtering failed', { error: errorMessage, query, taskCount: tasks.length });

    // Fallback: return first N tasks if filtering fails
    return tasks.slice(0, limit);
  }
}

/**
 * Check if query likely contains task-related keywords
 * Used to determine if we should fetch and filter tasks
 */
export function hasTaskKeywords(query: string): boolean {
  const taskKeywords = [
    'task', 'on', 'about', 'regarding', 'for', 'doing', 'working',
    'bug', 'feature', 'issue', 'ticket', 'fix', 'implement', 'develop',
    'design', 'meeting', 'review', 'testing', 'documentation'
  ];

  const lowerQuery = query.toLowerCase();
  return taskKeywords.some(keyword => lowerQuery.includes(keyword));
}
