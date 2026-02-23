export interface TimesheetEntry {
  project_id: number;
  project_name: string;
  task_id?: number;
  task_name?: string;
  hours: number;
  date: string; // YYYY-MM-DD format
  description: string;
  user_id?: number;
}

export interface ParsedTimesheetData {
  project_id: number | null;
  project_name: string | null;
  task_id: number | null;
  task_name: string | null;
  hours: number | null;
  date: string | null;
  description: string;
  confidence: number;
  error?: string;
  create_new_task?: boolean;
  new_task_name?: string | null;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

// Re-export OAuth types
export * from './oauth.types';
