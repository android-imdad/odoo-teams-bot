export interface OdooConfig {
  url: string;
  db: string;
  username: string;
  password: string;
}

export interface OdooProject {
  id: number;
  name: string;
  code?: string;
  active: boolean;
}

export interface OdooTimesheetParams {
  project_id: number;
  name: string; // description
  unit_amount: number; // hours
  date: string;
  user_id?: number;
}

export interface OdooAuthResult {
  uid: number;
}

export interface OdooSearchResult {
  id: number;
  [key: string]: any;
}
