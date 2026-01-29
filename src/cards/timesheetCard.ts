import { CardFactory, Attachment } from 'botbuilder';
import { TimesheetCardData } from '../types/bot.types';
import { format } from 'date-fns';

export class TimesheetCardGenerator {
  /**
   * Generate Adaptive Card for timesheet confirmation
   */
  static createConfirmationCard(data: TimesheetCardData): Attachment {
    const card = {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.3',
      body: [
        {
          type: 'TextBlock',
          text: 'Timesheet Entry',
          weight: 'Bolder',
          size: 'Large',
          color: 'Accent'
        },
        {
          type: 'TextBlock',
          text: 'Please confirm the following details:',
          wrap: true,
          spacing: 'Small'
        },
        {
          type: 'FactSet',
          facts: [
            {
              title: 'Project:',
              value: data.project_name
            },
            {
              title: 'Hours:',
              value: `${data.hours} hours`
            },
            {
              title: 'Date:',
              value: this.formatDate(data.date)
            },
            {
              title: 'Description:',
              value: data.description
            }
          ],
          spacing: 'Medium'
        }
      ],
      actions: [
        {
          type: 'Action.Submit',
          title: 'Confirm',
          data: { action: 'save_timesheet', ...data },
          style: 'positive'
        },
        {
          type: 'Action.Submit',
          title: 'Cancel',
          data: { action: 'cancel_timesheet', ...data },
          style: 'destructive'
        }
      ]
    };

    return CardFactory.adaptiveCard(card);
  }

  /**
   * Generate confirmed state card (replaces confirmation card)
   */
  static createConfirmedCard(data: TimesheetCardData): Attachment {
    const card = {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.3',
      body: [
        {
          type: 'TextBlock',
          text: '✓ Timesheet Confirmed',
          weight: 'Bolder',
          size: 'Large',
          color: 'Good'
        },
        {
          type: 'TextBlock',
          text: 'Your timesheet has been saved to Odoo.',
          wrap: true,
          spacing: 'Small'
        },
        {
          type: 'FactSet',
          facts: [
            {
              title: 'Project:',
              value: data.project_name
            },
            {
              title: 'Hours:',
              value: `${data.hours} hours`
            },
            {
              title: 'Date:',
              value: this.formatDate(data.date)
            },
            {
              title: 'Description:',
              value: data.description
            }
          ],
          spacing: 'Medium'
        }
      ]
    };

    return CardFactory.adaptiveCard(card);
  }

  /**
   * Generate cancelled state card (replaces confirmation card)
   */
  static createCancelledStateCard(data: TimesheetCardData): Attachment {
    const card = {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.3',
      body: [
        {
          type: 'TextBlock',
          text: '✗ Timesheet Cancelled',
          weight: 'Bolder',
          size: 'Large',
          color: 'Warning'
        },
        {
          type: 'TextBlock',
          text: 'No timesheet entry was created.',
          wrap: true,
          spacing: 'Small'
        },
        {
          type: 'FactSet',
          facts: [
            {
              title: 'Project:',
              value: data.project_name
            },
            {
              title: 'Hours:',
              value: `${data.hours} hours`
            },
            {
              title: 'Date:',
              value: this.formatDate(data.date)
            }
          ],
          spacing: 'Medium',
          isVisible: false
        }
      ]
    };

    return CardFactory.adaptiveCard(card);
  }

  /**
   * Generate error card for parsing failures
   */
  static createErrorCard(
    errorMessage: string,
    originalText?: string
  ): Attachment {
    const card = {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.4',
      body: [
        {
          type: 'TextBlock',
          text: 'Unable to Parse Timesheet',
          weight: 'Bolder',
          size: 'Large',
          color: 'Attention'
        },
        {
          type: 'TextBlock',
          text: errorMessage,
          wrap: true,
          color: 'Attention',
          spacing: 'Medium'
        },
        ...(originalText ? [
          {
            type: 'TextBlock',
            text: 'Your input:',
            weight: 'Bolder',
            spacing: 'Medium'
          },
          {
            type: 'TextBlock',
            text: originalText,
            wrap: true,
            isSubtle: true
          }
        ] : []),
        {
          type: 'TextBlock',
          text: 'Please try again with a clearer format, for example:',
          wrap: true,
          spacing: 'Medium'
        },
        {
          type: 'TextBlock',
          text: '"I spent 4 hours on project SSI fixing the payment gateway"',
          wrap: true,
          isSubtle: true,
          fontType: 'Monospace'
        }
      ]
    };

    return CardFactory.adaptiveCard(card);
  }

  /**
   * Generate success card after timesheet creation
   */
  static createSuccessCard(data: TimesheetCardData): Attachment {
    const card = {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.4',
      body: [
        {
          type: 'TextBlock',
          text: '✓ Timesheet Saved',
          weight: 'Bolder',
          size: 'Large',
          color: 'Good'
        },
        {
          type: 'TextBlock',
          text: 'Your timesheet entry has been successfully saved to Odoo.',
          wrap: true,
          spacing: 'Small'
        },
        {
          type: 'FactSet',
          facts: [
            {
              title: 'Project:',
              value: data.project_name
            },
            {
              title: 'Hours:',
              value: `${data.hours} hours`
            },
            {
              title: 'Date:',
              value: this.formatDate(data.date)
            }
          ],
          spacing: 'Medium'
        }
      ]
    };

    return CardFactory.adaptiveCard(card);
  }

  /**
   * Generate cancellation card
   */
  static createCancelledCard(): Attachment {
    const card = {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.4',
      body: [
        {
          type: 'TextBlock',
          text: 'Timesheet Cancelled',
          weight: 'Bolder',
          size: 'Medium',
          color: 'Warning'
        },
        {
          type: 'TextBlock',
          text: 'No timesheet entry was created.',
          wrap: true,
          spacing: 'Small'
        }
      ]
    };

    return CardFactory.adaptiveCard(card);
  }

  /**
   * Format date for display
   */
  private static formatDate(date: string): string {
    try {
      const parsed = new Date(date);
      return format(parsed, 'EEEE, MMMM d, yyyy');
    } catch {
      return date;
    }
  }
}
