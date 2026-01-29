import { format, parseISO, isValid } from 'date-fns';

export class Formatter {
  /**
   * Format hours for display
   */
  static formatHours(hours: number): string {
    return `${hours.toFixed(2)} hour${hours !== 1 ? 's' : ''}`;
  }

  /**
   * Format date for display
   */
  static formatDate(dateString: string, formatStr: string = 'PPP'): string {
    try {
      const date = parseISO(dateString);
      if (!isValid(date)) {
        return dateString;
      }
      return format(date, formatStr);
    } catch {
      return dateString;
    }
  }

  /**
   * Truncate text to max length
   */
  static truncate(text: string, maxLength: number = 100): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }
}
