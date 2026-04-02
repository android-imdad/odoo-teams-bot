export interface AdaptiveCardAction {
  type: string;
  verb: string;
  data: TimesheetCardData;
}

export interface TimesheetCardData {
  project_id: number;
  project_name: string;
  task_id?: number;
  task_name?: string;
  create_new_task?: boolean;
  new_task_name?: string;
  hours: number;
  date: string;
  description: string;
  billable?: boolean; // true = billable, false = non-billable, undefined = not set
}

export interface BotError extends Error {
  code?: string;
  context?: any;
  recoverable?: boolean;
}
