import { TimesheetCardData } from '../types/bot.types';

export class Validator {
  /**
   * Validate timesheet card data
   */
  static validateTimesheetData(data: TimesheetCardData): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!data.project_id || typeof data.project_id !== 'number') {
      errors.push('Invalid project ID');
    }

    if (!data.project_name || typeof data.project_name !== 'string') {
      errors.push('Invalid project name');
    }

    if (!data.hours || typeof data.hours !== 'number' || data.hours <= 0) {
      errors.push('Invalid hours (must be greater than 0)');
    }

    if (!data.date || !this.isValidDate(data.date)) {
      errors.push('Invalid date format (expected YYYY-MM-DD)');
    }

    if (!data.description || typeof data.description !== 'string') {
      errors.push('Invalid description');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate date format
   */
  private static isValidDate(dateString: string): boolean {
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateString)) {
      return false;
    }

    const date = new Date(dateString);
    return !isNaN(date.getTime());
  }
}
