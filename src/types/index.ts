export interface TimesheetEntry {
  project_id: number;
  project_name: string;
  hours: number;
  date: string; // YYYY-MM-DD format
  description: string;
  user_id?: number;
}

export interface ParsedTimesheetData {
  project_id: number | null;
  project_name: string | null;
  hours: number | null;
  date: string | null;
  description: string;
  confidence: number;
  error?: string;
}

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}
