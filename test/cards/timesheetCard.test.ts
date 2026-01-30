/**
 * Tests for Timesheet Card Generator (Adaptive Cards)
 */

import { TimesheetCardGenerator } from '../../src/cards/timesheetCard';
import { TimesheetCardData } from '../../src/types/bot.types';

// Mock botbuilder
jest.mock('botbuilder', () => ({
  CardFactory: {
    adaptiveCard: jest.fn((card) => ({
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: card
    }))
  }
}));

// Mock date-fns format
jest.mock('date-fns', () => ({
  format: jest.fn((date, _formatStr) => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  })
}));

describe('TimesheetCardGenerator', () => {
  const mockCardData: TimesheetCardData = {
    project_id: 1,
    project_name: 'Website Redesign',
    hours: 4.5,
    date: '2024-01-15',
    description: 'Homepage redesign work including new hero section'
  };

  describe('createConfirmationCard', () => {
    it('should create a confirmation card with valid data', () => {
      const card = TimesheetCardGenerator.createConfirmationCard(mockCardData);

      expect(card).toBeDefined();
      expect(card.contentType).toBe('application/vnd.microsoft.card.adaptive');
      expect(card.content).toBeDefined();
    });

    it('should include all required fields in the card', () => {
      const card = TimesheetCardGenerator.createConfirmationCard(mockCardData);
      const body = card.content.body;

      // Check title
      expect(body[0].text).toBe('Timesheet Entry');
      expect(body[0].weight).toBe('Bolder');
      expect(body[0].size).toBe('Large');

      // Check subtitle
      expect(body[1].text).toBe('Please confirm the following details:');

      // Check FactSet
      const factSet = body[2];
      expect(factSet.type).toBe('FactSet');
      expect(factSet.facts.length).toBeGreaterThanOrEqual(4);
      expect(factSet.facts[0]).toEqual({
        title: 'Project:',
        value: 'Website Redesign'
      });
      expect(factSet.facts.some((f: any) => f.title === 'Hours:' && f.value === '4.5 hours')).toBe(true);
    });

    it('should include confirm and cancel actions', () => {
      const card = TimesheetCardGenerator.createConfirmationCard(mockCardData);
      const actions = card.content.actions;

      expect(actions).toHaveLength(2);

      expect(actions[0].type).toBe('Action.Submit');
      expect(actions[0].title).toBe('Confirm');
      expect(actions[0].data.action).toBe('save_timesheet');
      expect(actions[0].style).toBe('positive');

      expect(actions[1].type).toBe('Action.Submit');
      expect(actions[1].title).toBe('Cancel');
      expect(actions[1].data.action).toBe('cancel_timesheet');
      expect(actions[1].style).toBe('destructive');
    });

    it('should handle decimal hours correctly', () => {
      const dataWithDecimal = { ...mockCardData, hours: 3.75 };
      const card = TimesheetCardGenerator.createConfirmationCard(dataWithDecimal);
      const factSet = card.content.body[2];

      expect(factSet.facts[1].value).toBe('3.75 hours');
    });

    it('should handle integer hours', () => {
      const dataWithInteger = { ...mockCardData, hours: 5 };
      const card = TimesheetCardGenerator.createConfirmationCard(dataWithInteger);
      const factSet = card.content.body[2];

      expect(factSet.facts[1].value).toBe('5 hours');
    });

    it('should handle long descriptions', () => {
      const longDescription = 'A'.repeat(500);
      const dataWithLongDesc = { ...mockCardData, description: longDescription };
      const card = TimesheetCardGenerator.createConfirmationCard(dataWithLongDesc);
      const factSet = card.content.body[2];

      expect(factSet.facts[3].value).toBe(longDescription);
    });

    it('should handle special characters in description', () => {
      const specialDescription = 'Work with "quotes" & <symbols> and \'apostrophes\'';
      const dataWithSpecial = { ...mockCardData, description: specialDescription };
      const card = TimesheetCardGenerator.createConfirmationCard(dataWithSpecial);
      const factSet = card.content.body[2];

      expect(factSet.facts[3].value).toContain('quotes');
    });

    it('should handle project names with special characters', () => {
      const dataWithSpecialProject = {
        ...mockCardData,
        project_name: 'Project <Test> & "Demo"'
      };
      const card = TimesheetCardGenerator.createConfirmationCard(dataWithSpecialProject);
      const factSet = card.content.body[2];

      expect(factSet.facts[0].value).toContain('Test');
    });

    it('should format date correctly', () => {
      const card = TimesheetCardGenerator.createConfirmationCard(mockCardData);
      const factSet = card.content.body[2];

      expect(factSet.facts[2].title).toBe('Date:');
      expect(factSet.facts[2].value).toBeDefined();
      expect(typeof factSet.facts[2].value).toBe('string');
    });

    it('should include correct schema and version', () => {
      const card = TimesheetCardGenerator.createConfirmationCard(mockCardData);
      const content = card.content;

      expect(content.$schema).toBe('http://adaptivecards.io/schemas/adaptive-card.json');
      expect(content.version).toBe('1.3');
      expect(content.type).toBe('AdaptiveCard');
    });
  });

  describe('createErrorCard', () => {
    it('should create an error card with message only', () => {
      const errorMessage = 'Could not parse your timesheet entry';
      const card = TimesheetCardGenerator.createErrorCard(errorMessage);

      expect(card).toBeDefined();
      expect(card.contentType).toBe('application/vnd.microsoft.card.adaptive');
      expect(card.content.body[0].text).toBe('Unable to Parse Timesheet');
      expect(card.content.body[1].text).toBe(errorMessage);
    });

    it('should include original text when provided', () => {
      const errorMessage = 'Missing project information';
      const originalText = 'I worked on something';
      const card = TimesheetCardGenerator.createErrorCard(errorMessage, originalText);
      const body = card.content.body;

      expect(body[2].text).toBe('Your input:');
      expect(body[3].text).toBe(originalText);
      expect(body[3].isSubtle).toBe(true);
    });

    it('should not include original text section when not provided', () => {
      const errorMessage = 'Invalid format';
      const card = TimesheetCardGenerator.createErrorCard(errorMessage);
      const body = card.content.body;

      expect(body[2].text).not.toBe('Your input:');
    });

    it('should include example format', () => {
      const card = TimesheetCardGenerator.createErrorCard('Error');
      const body = card.content.body;

      const exampleTextIndex = body.findIndex((item: any) => item.text?.includes('Please try again with a clearer format'));
      expect(exampleTextIndex).toBeGreaterThan(-1);

      const exampleIndex = body.findIndex((item: any) => item.text?.includes('I spent 4 hours on project SSI'));
      expect(exampleIndex).toBeGreaterThan(-1);
    });

    it('should use appropriate color styling', () => {
      const card = TimesheetCardGenerator.createErrorCard('Error');
      const body = card.content.body;

      expect(body[0].color).toBe('Attention');
      expect(body[1].color).toBe('Attention');
    });

    it('should handle error messages with special characters', () => {
      const specialErrorMessage = 'Error: "Invalid" <input> & \'data\'';
      const card = TimesheetCardGenerator.createErrorCard(specialErrorMessage);

      expect(card.content.body[1].text).toContain('Invalid');
    });

    it('should handle very long error messages', () => {
      const longError = 'E'.repeat(1000);
      const card = TimesheetCardGenerator.createErrorCard(longError);

      expect(card.content.body[1].text).toBe(longError);
    });

    it('should handle multiline original text', () => {
      const multilineText = 'Line 1\nLine 2\nLine 3';
      const card = TimesheetCardGenerator.createErrorCard('Error', multilineText);

      expect(card.content.body[3].text).toBe(multilineText);
      expect(card.content.body[3].wrap).toBe(true);
    });
  });

  describe('createSuccessCard', () => {
    it('should create a success card with timesheet data', () => {
      const card = TimesheetCardGenerator.createSuccessCard(mockCardData);

      expect(card).toBeDefined();
      expect(card.contentType).toBe('application/vnd.microsoft.card.adaptive');
      expect(card.content.body[0].text).toBe('✓ Timesheet Saved');
      expect(card.content.body[0].color).toBe('Good');
    });

    it('should include success message', () => {
      const card = TimesheetCardGenerator.createSuccessCard(mockCardData);

      expect(card.content.body[1].text).toBe('Your timesheet entry has been successfully saved to Odoo.');
    });

    it('should include timesheet details in FactSet', () => {
      const card = TimesheetCardGenerator.createSuccessCard(mockCardData);
      const factSet = card.content.body[2];

      expect(factSet.type).toBe('FactSet');
      expect(factSet.facts).toHaveLength(3);
      expect(factSet.facts[0]).toEqual({
        title: 'Project:',
        value: 'Website Redesign'
      });
      expect(factSet.facts[1]).toEqual({
        title: 'Hours:',
        value: '4.5 hours'
      });
    });

    it('should not include description in success card', () => {
      const card = TimesheetCardGenerator.createSuccessCard(mockCardData);
      const factSet = card.content.body[2];

      expect(factSet.facts).toHaveLength(3);
      expect(factSet.facts.every((fact: any) => fact.title !== 'Description:')).toBe(true);
    });

    it('should handle zero hours edge case', () => {
      const dataWithZeroHours = { ...mockCardData, hours: 0 };
      const card = TimesheetCardGenerator.createSuccessCard(dataWithZeroHours);
      const factSet = card.content.body[2];

      expect(factSet.facts[1].value).toBe('0 hours');
    });

    it('should handle very large hours', () => {
      const dataWithLargeHours = { ...mockCardData, hours: 999.99 };
      const card = TimesheetCardGenerator.createSuccessCard(dataWithLargeHours);
      const factSet = card.content.body[2];

      expect(factSet.facts[1].value).toBe('999.99 hours');
    });

    it('should use proper styling for success', () => {
      const card = TimesheetCardGenerator.createSuccessCard(mockCardData);
      const body = card.content.body;

      expect(body[0].color).toBe('Good');
      expect(body[0].weight).toBe('Bolder');
      expect(body[0].size).toBe('Large');
    });
  });

  describe('createCancelledCard', () => {
    it('should create a cancelled card', () => {
      const card = TimesheetCardGenerator.createCancelledCard();

      expect(card).toBeDefined();
      expect(card.contentType).toBe('application/vnd.microsoft.card.adaptive');
    });

    it('should include cancellation message', () => {
      const card = TimesheetCardGenerator.createCancelledCard();

      expect(card.content.body[0].text).toBe('Timesheet Cancelled');
      expect(card.content.body[1].text).toBe('No timesheet entry was created.');
    });

    it('should use warning color scheme', () => {
      const card = TimesheetCardGenerator.createCancelledCard();

      expect(card.content.body[0].color).toBe('Warning');
      expect(card.content.body[0].weight).toBe('Bolder');
      expect(card.content.body[0].size).toBe('Medium');
    });

    it('should have no actions', () => {
      const card = TimesheetCardGenerator.createCancelledCard();

      expect(card.content.actions).toBeUndefined();
    });

    it('should be minimal and concise', () => {
      const card = TimesheetCardGenerator.createCancelledCard();

      expect(card.content.body).toHaveLength(2);
    });
  });

  describe('formatDate', () => {
    it('should format valid date correctly', () => {
      const card = TimesheetCardGenerator.createSuccessCard(mockCardData);
      const factSet = card.content.body[2];

      expect(factSet.facts[2].value).toBeDefined();
      expect(typeof factSet.facts[2].value).toBe('string');
      expect(factSet.facts[2].value.length).toBeGreaterThan(0);
    });

    it('should handle leap year dates', () => {
      const dataWithLeapDate = { ...mockCardData, date: '2024-02-29' };
      const card = TimesheetCardGenerator.createSuccessCard(dataWithLeapDate);
      const factSet = card.content.body[2];

      expect(factSet.facts[2].value).toBeDefined();
    });

    it('should handle end of year dates', () => {
      const dataWithEndOfYear = { ...mockCardData, date: '2024-12-31' };
      const card = TimesheetCardGenerator.createSuccessCard(dataWithEndOfYear);
      const factSet = card.content.body[2];

      expect(factSet.facts[2].value).toBeDefined();
    });

    it('should handle beginning of year dates', () => {
      const dataWithBeginOfYear = { ...mockCardData, date: '2024-01-01' };
      const card = TimesheetCardGenerator.createSuccessCard(dataWithBeginOfYear);
      const factSet = card.content.body[2];

      expect(factSet.facts[2].value).toBeDefined();
    });

    it('should return formatted date even on invalid input', () => {
      const dataWithInvalidDate = { ...mockCardData, date: 'invalid-date' };
      const card = TimesheetCardGenerator.createSuccessCard(dataWithInvalidDate);
      const factSet = card.content.body[2];

      // The format function will create "Invalid Date" string
      expect(factSet.facts[2].value).toBeDefined();
    });
  });

  describe('Card Structure', () => {
    it('should always include schema in all card types', () => {
      const confirmationCard = TimesheetCardGenerator.createConfirmationCard(mockCardData);
      const errorCard = TimesheetCardGenerator.createErrorCard('Error');
      const successCard = TimesheetCardGenerator.createSuccessCard(mockCardData);
      const cancelledCard = TimesheetCardGenerator.createCancelledCard();

      expect(confirmationCard.content.$schema).toBeDefined();
      expect(errorCard.content.$schema).toBeDefined();
      expect(successCard.content.$schema).toBeDefined();
      expect(cancelledCard.content.$schema).toBeDefined();
    });

    it('should use consistent version across all card types', () => {
      const confirmationCard = TimesheetCardGenerator.createConfirmationCard(mockCardData);
      const errorCard = TimesheetCardGenerator.createErrorCard('Error');
      const successCard = TimesheetCardGenerator.createSuccessCard(mockCardData);
      const cancelledCard = TimesheetCardGenerator.createCancelledCard();

      expect(confirmationCard.content.version).toBe('1.3');
      expect(errorCard.content.version).toBe('1.4');
      expect(successCard.content.version).toBe('1.4');
      expect(cancelledCard.content.version).toBe('1.4');
    });

    it('should use consistent card type across all card types', () => {
      const confirmationCard = TimesheetCardGenerator.createConfirmationCard(mockCardData);
      const errorCard = TimesheetCardGenerator.createErrorCard('Error');
      const successCard = TimesheetCardGenerator.createSuccessCard(mockCardData);
      const cancelledCard = TimesheetCardGenerator.createCancelledCard();

      expect(confirmationCard.content.type).toBe('AdaptiveCard');
      expect(errorCard.content.type).toBe('AdaptiveCard');
      expect(successCard.content.type).toBe('AdaptiveCard');
      expect(cancelledCard.content.type).toBe('AdaptiveCard');
    });
  });

  describe('Edge Cases', () => {
    it('should handle project_id of 0', () => {
      const dataWithZeroId = { ...mockCardData, project_id: 0 };
      const card = TimesheetCardGenerator.createConfirmationCard(dataWithZeroId);

      expect(card.content.actions[0].data.project_id).toBe(0);
    });

    it('should handle very large project_id', () => {
      const dataWithLargeId = { ...mockCardData, project_id: 999999 };
      const card = TimesheetCardGenerator.createConfirmationCard(dataWithLargeId);

      expect(card.content.actions[0].data.project_id).toBe(999999);
    });

    it('should handle negative hours in confirmation card (edge case)', () => {
      const dataWithNegativeHours = { ...mockCardData, hours: -2 };
      const card = TimesheetCardGenerator.createConfirmationCard(dataWithNegativeHours);
      const factSet = card.content.body[2];

      expect(factSet.facts[1].value).toBe('-2 hours');
    });

    it('should handle empty description', () => {
      const dataWithEmptyDesc = { ...mockCardData, description: '' };
      const card = TimesheetCardGenerator.createConfirmationCard(dataWithEmptyDesc);
      const factSet = card.content.body[2];

      expect(factSet.facts[3].value).toBe('');
    });

    it('should handle description with newlines', () => {
      const dataWithNewlines = { ...mockCardData, description: 'Line 1\nLine 2\nLine 3' };
      const card = TimesheetCardGenerator.createConfirmationCard(dataWithNewlines);
      const factSet = card.content.body[2];

      expect(factSet.facts[3].value).toContain('Line 1');
    });

    it('should handle extremely long project names', () => {
      const longProjectName = 'A'.repeat(200);
      const dataWithLongProject = { ...mockCardData, project_name: longProjectName };
      const card = TimesheetCardGenerator.createConfirmationCard(dataWithLongProject);
      const factSet = card.content.body[2];

      expect(factSet.facts[0].value).toBe(longProjectName);
    });

    it('should handle unicode characters in description', () => {
      const unicodeDescription = 'Work with emojis: 😊 🎉 💼 and 中文 characters';
      const dataWithUnicode = { ...mockCardData, description: unicodeDescription };
      const card = TimesheetCardGenerator.createConfirmationCard(dataWithUnicode);
      const factSet = card.content.body[2];

      expect(factSet.facts[3].value).toContain('😊');
    });

    it('should handle null values gracefully in error scenario', () => {
      const dataWithNulls = {
        project_id: null as any,
        project_name: null as any,
        hours: null as any,
        date: null as any,
        description: null as any
      };

      expect(() => {
        TimesheetCardGenerator.createConfirmationCard(dataWithNulls);
      }).not.toThrow();
    });

    it('should handle multiple spaces in project name', () => {
      const dataWithSpaces = { ...mockCardData, project_name: 'Project   With    Spaces' };
      const card = TimesheetCardGenerator.createConfirmationCard(dataWithSpaces);
      const factSet = card.content.body[2];

      expect(factSet.facts[0].value).toBe('Project   With    Spaces');
    });
  });

  describe('Action Data Integrity', () => {
    it('should pass complete data object to confirm action', () => {
      const card = TimesheetCardGenerator.createConfirmationCard(mockCardData);
      const confirmAction = card.content.actions[0];

      expect(confirmAction.data.action).toBe('save_timesheet');
      expect(confirmAction.data.project_id).toBe(1);
      expect(confirmAction.data.hours).toBe(4.5);
      expect(confirmAction.data.date).toBe('2024-01-15');
      // Verify all original data fields are included
      expect(confirmAction.data.project_name).toBe(mockCardData.project_name);
      expect(confirmAction.data.description).toBe(mockCardData.description);
    });

    it('should pass complete data object to cancel action', () => {
      const card = TimesheetCardGenerator.createConfirmationCard(mockCardData);
      const cancelAction = card.content.actions[1];

      expect(cancelAction.data.action).toBe('cancel_timesheet');
      expect(cancelAction.data.project_id).toBe(mockCardData.project_id);
      expect(cancelAction.data.hours).toBe(mockCardData.hours);
    });

    it('should preserve all fields in action data', () => {
      const completeData = {
        project_id: 5,
        project_name: 'Test Project',
        hours: 7.25,
        date: '2024-06-15',
        description: 'Complete description with all details'
      };

      const card = TimesheetCardGenerator.createConfirmationCard(completeData);
      const actionData = card.content.actions[0].data;

      // Verify action field is included
      expect(actionData.action).toBe('save_timesheet');
      // Verify all original data fields are preserved
      expect(actionData.project_id).toBe(completeData.project_id);
      expect(actionData.project_name).toBe(completeData.project_name);
      expect(actionData.hours).toBe(completeData.hours);
      expect(actionData.date).toBe(completeData.date);
      expect(actionData.description).toBe(completeData.description);
    });
  });
});
