import { CardFactory, Attachment } from 'botbuilder';
import { TimesheetCardData } from '../types/bot.types';
import { format } from 'date-fns';
import { BillabilityPreferenceService } from '../services/billabilityPreference';

export class TimesheetCardGenerator {
  /**
   * Get the billability display label for a card
   */
  private static getBillabilityLabel(billable: boolean | undefined): string {
    return BillabilityPreferenceService.getLabel(billable);
  }

  /**
   * Generate Adaptive Card for timesheet confirmation
   */
  static createConfirmationCard(data: TimesheetCardData): Attachment {
    const card = {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.5',
      body: [
        {
          type: 'Container',
          items: [
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
              spacing: 'Small',
              isSubtle: true
            }
          ]
        },
        ...(data.create_new_task && data.new_task_name ? [
          {
            type: 'TextBlock',
            text: '⚠️ New task will be created',
            weight: 'Bolder',
            color: 'Warning',
            spacing: 'Small'
          }
        ] : []),
        {
          type: 'FactSet',
          facts: [
            {
              title: 'Project:',
              value: data.project_name
            },
            ...(data.task_name ? [{
              title: 'Task:',
              value: data.task_name
            }] : []),
            ...(data.create_new_task && data.new_task_name ? [{
              title: 'New Task:',
              value: `${data.new_task_name} (will be created)`
            }] : []),
            {
              title: 'Hours:',
              value: `${data.hours} hours`
            },
            {
              title: 'Date:',
              value: this.formatDate(data.date)
            },
            {
              title: 'Billable:',
              value: this.getBillabilityLabel(data.billable)
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
      version: '1.5',
      body: [
        {
          type: 'Container',
          items: [
            {
              type: 'TextBlock',
              text: '✓ Timesheet Confirmed',
              weight: 'Bolder',
              size: 'Large',
              color: 'Good'
            },
            {
              type: 'TextBlock',
              text: data.create_new_task
                ? 'Your timesheet has been saved to Odoo. A new task was created.'
                : 'Your timesheet has been saved to Odoo.',
              wrap: true,
              spacing: 'Small',
              isSubtle: true
            }
          ]
        },
        {
          type: 'FactSet',
          facts: [
            {
              title: 'Project:',
              value: data.project_name
            },
            ...(data.task_name ? [{
              title: 'Task:',
              value: data.task_name
            }] : []),
            {
              title: 'Hours:',
              value: `${data.hours} hours`
            },
            {
              title: 'Date:',
              value: this.formatDate(data.date)
            },
            {
              title: 'Billable:',
              value: this.getBillabilityLabel(data.billable)
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
      version: '1.5',
      body: [
        {
          type: 'Container',
          items: [
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
              spacing: 'Small',
              isSubtle: true
            }
          ]
        },
        {
          type: 'FactSet',
          facts: [
            {
              title: 'Project:',
              value: data.project_name
            },
            ...(data.task_name ? [{
              title: 'Task:',
              value: data.task_name
            }] : []),
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
      version: '1.5',
      body: [
        {
          type: 'Container',
          items: [
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
            }
          ]
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
      version: '1.5',
      body: [
        {
          type: 'Container',
          items: [
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
              spacing: 'Small',
              isSubtle: true
            }
          ]
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
      version: '1.5',
      body: [
        {
          type: 'Container',
          items: [
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
              spacing: 'Small',
              isSubtle: true
            }
          ]
        }
      ]
    };

    return CardFactory.adaptiveCard(card);
  }

  /**
   * Generate welcome card with sample prompts and billability info
   */
  static createWelcomeCard(teamsEmail?: string, currentBillability?: string): Attachment {
    const card = {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.5',
      body: [
        {
          type: 'Container',
          items: [
            {
              type: 'TextBlock',
              text: '🎉 Welcome to the Odoo Timesheet Bot!',
              weight: 'Bolder',
              size: 'Large',
              color: 'Accent'
            },
            {
              type: 'TextBlock',
              text: teamsEmail
                ? `Your timesheets will be logged for: **${teamsEmail}**`
                : 'You\'re all set to start logging timesheets!',
              wrap: true,
              spacing: 'Small'
            }
          ]
        },
        {
          type: 'Container',
          spacing: 'Medium',
          items: [
            {
              type: 'TextBlock',
              text: '📝 Sample Time Log Prompts',
              weight: 'Bolder',
              size: 'Medium'
            },
            {
              type: 'TextBlock',
              text: '• "4 hours on Website project fixing homepage layout"',
              wrap: true,
              spacing: 'Small',
              fontType: 'Monospace',
              size: 'Small'
            },
            {
              type: 'TextBlock',
              text: '• "2.5h on SSI project code review, billable"',
              wrap: true,
              spacing: 'Small',
              fontType: 'Monospace',
              size: 'Small'
            },
            {
              type: 'TextBlock',
              text: '• "yesterday 3 hours internal meeting on Project Alpha, non-billable"',
              wrap: true,
              spacing: 'Small',
              fontType: 'Monospace',
              size: 'Small'
            },
            {
              type: 'TextBlock',
              text: '• "logged 6h on Client Portal create task API integration"',
              wrap: true,
              spacing: 'Small',
              fontType: 'Monospace',
              size: 'Small'
            }
          ]
        },
        {
          type: 'Container',
          spacing: 'Medium',
          items: [
            {
              type: 'TextBlock',
              text: '⚙️ Billability Settings',
              weight: 'Bolder',
              size: 'Medium'
            },
            {
              type: 'TextBlock',
              text: currentBillability
                ? `Current default: **${currentBillability}**`
                : 'No default billability set. Each entry will use the Odoo project default.',
              wrap: true,
              spacing: 'Small'
            },
            {
              type: 'TextBlock',
              text: 'Set a default so you don\'t have to specify it every time:',
              wrap: true,
              spacing: 'Small',
              isSubtle: true
            }
          ]
        }
      ],
      actions: [
        {
          type: 'Action.Submit',
          title: '💰 Set Default: Billable',
          data: { action: 'set_billability', billability: 'billable' },
          style: 'positive'
        },
        {
          type: 'Action.Submit',
          title: '🏷️ Set Default: Non-Billable',
          data: { action: 'set_billability', billability: 'non-billable' }
        }
      ]
    };

    return CardFactory.adaptiveCard(card);
  }

  /**
   * Generate billability settings card
   */
  static createBillabilitySettingsCard(currentPreference: string): Attachment {
    const card = {
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.5',
      body: [
        {
          type: 'Container',
          items: [
            {
              type: 'TextBlock',
              text: '⚙️ Billability Settings',
              weight: 'Bolder',
              size: 'Large',
              color: 'Accent'
            },
            {
              type: 'TextBlock',
              text: `Current default: **${currentPreference}**`,
              wrap: true,
              spacing: 'Small'
            },
            {
              type: 'TextBlock',
              text: 'Choose a default billability for all your timesheet entries. You can always override it by saying "billable" or "non-billable" in your time log message.',
              wrap: true,
              spacing: 'Medium',
              isSubtle: true
            }
          ]
        }
      ],
      actions: [
        {
          type: 'Action.Submit',
          title: '💰 Set Billable',
          data: { action: 'set_billability', billability: 'billable' },
          style: 'positive'
        },
        {
          type: 'Action.Submit',
          title: '🏷️ Set Non-Billable',
          data: { action: 'set_billability', billability: 'non-billable' }
        },
        {
          type: 'Action.Submit',
          title: '⚪ Clear Default',
          data: { action: 'set_billability', billability: 'unset' },
          style: 'destructive'
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
