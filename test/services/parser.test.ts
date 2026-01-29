/**
 * Tests for Parser Service (Gemini AI parsing)
 */

// Mock Google Generative AI - must be before imports
import { GoogleGenerativeAI } from '@google/generative-ai';

jest.mock('@google/generative-ai');

// Create mock function
const mockGenerateContent = jest.fn();

// Setup the mock implementation
beforeAll(() => {
  (GoogleGenerativeAI as jest.Mock).mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: mockGenerateContent
    })
  }));
});

import { ParserService } from '../../src/services/parser';
import { OdooProject } from '../../src/types/odoo.types';

// Mock date-fns format
jest.mock('date-fns', () => ({
  format: jest.fn((date, _formatStr) => {
    const d = new Date(date);
    return d.toISOString().split('T')[0]; // Return YYYY-MM-DD
  })
}));

// Mock logger
jest.mock('../../src/config/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }
}));

// Mock config
jest.mock('../../src/config/config', () => ({
  config: {
    gemini: {
      apiKey: 'test-api-key',
      model: 'gemini-test'
    }
  }
}));

describe('ParserService', () => {
  let parserService: ParserService;

  const mockProjects: OdooProject[] = [
    { id: 1, name: 'Website Redesign', code: 'WEB', active: true },
    { id: 2, name: 'Mobile App Development', code: 'MOB', active: true },
    { id: 3, name: 'Database Migration', code: 'DB', active: true },
    { id: 4, name: 'API Integration', code: undefined, active: true }
  ];

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a new ParserService instance
    parserService = new ParserService();
  });

  describe('parseText', () => {
    it('should successfully parse valid timesheet text', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4.5,
            date: '2024-01-15',
            description: 'Homepage redesign work',
            confidence: 0.95
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('I spent 4.5 hours on Website Redesign doing homepage work', mockProjects);

      expect(result).toEqual({
        project_id: 1,
        project_name: 'Website Redesign',
        hours: 4.5,
        date: '2024-01-15',
        description: 'Homepage redesign work',
        confidence: 0.95
      });
    });

    it('should parse text with project code instead of name', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 2,
            project_name: 'Mobile App Development',
            hours: 3,
            date: '2024-01-15',
            description: 'Bug fixes',
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('3 hours on MOB fixing bugs', mockProjects);

      expect(result.project_id).toBe(2);
      expect(result.project_name).toBe('Mobile App Development');
      expect(result.hours).toBe(3);
    });

    it('should parse text with relative date references', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 3,
            project_name: 'Database Migration',
            hours: 6,
            date: '2024-01-14',
            description: 'Schema updates',
            confidence: 0.85
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Yesterday I spent 6 hours on DB migration doing schema updates', mockProjects);

      expect(result.date).toBe('2024-01-14');
    });

    it('should handle parsing with null project when project cannot be identified', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: null,
            project_name: null,
            hours: 2,
            date: '2024-01-15',
            description: 'Some unknown project work',
            confidence: 0.5
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('I spent 2 hours on some project', mockProjects);

      expect(result.project_id).toBeNull();
      expect(result.project_name).toBeNull();
      expect(result.error).toBe('Project could not be identified');
    });

    it('should handle parsing with null hours when hours cannot be extracted', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: null,
            date: '2024-01-15',
            description: 'Did some work',
            confidence: 0.6
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('I worked on Website Redesign', mockProjects);

      expect(result.hours).toBeNull();
      expect(result.error).toBe('Hours could not be extracted');
    });

    it('should handle parsing with null date when date cannot be determined', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4,
            date: null,
            description: 'Some work',
            confidence: 0.7
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('4 hours on Website Redesign', mockProjects);

      expect(result.date).toBeNull();
      expect(result.error).toBe('Date could not be determined');
    });

    it('should handle AI API errors and return safe fallback', async () => {
      mockGenerateContent.mockRejectedValue(new Error('AI API error'));

      const result = await parserService.parseText('Test input', mockProjects);

      expect(result).toEqual({
        project_id: null,
        project_name: null,
        hours: null,
        date: null,
        description: 'Test input',
        confidence: 0,
        error: 'AI API error'
      });
    });

    it('should handle invalid JSON response from AI', async () => {
      const mockResponse = {
        response: {
          text: () => 'This is not valid JSON'
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test input', mockProjects);

      expect(result).toEqual({
        project_id: null,
        project_name: null,
        hours: null,
        date: null,
        description: 'Test input',
        confidence: 0,
        error: 'Invalid response format from AI'
      });
    });

    it('should extract JSON from response with additional text', async () => {
      const mockResponse = {
        response: {
          text: () => 'Here is the parsed data:\n{"project_id": 1, "project_name": "Website Redesign", "hours": 4, "date": "2024-01-15", "description": "Work", "confidence": 0.9}\nLet me know if you need anything else.'
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('4 hours on Website Redesign', mockProjects);

      expect(result.project_id).toBe(1);
      expect(result.confidence).toBe(0.9);
    });

    it('should handle empty project list', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: null,
            project_name: null,
            hours: 4,
            date: '2024-01-15',
            description: 'Work',
            confidence: 0.3
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('4 hours of work', []);

      expect(result.project_id).toBeNull();
      expect(result.project_name).toBeNull();
    });

    it('should handle multiple errors in parsed data', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: null,
            project_name: null,
            hours: null,
            date: null,
            description: 'Some text',
            confidence: 0.2
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Some text', mockProjects);

      expect(result.error).toBe('Project could not be identified'); // First error in priority
    });
  });

  describe('validateParsedData', () => {
    it('should validate all fields correctly', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4.5,
            date: '2024-01-15',
            description: 'Test work',
            confidence: 0.95
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.project_id).toBe(1);
      expect(result.hours).toBe(4.5);
      expect(result.confidence).toBe(0.95);
      expect(result.error).toBeUndefined();
    });

    it('should sanitize invalid project_id types', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: '1' as any,
            project_name: 'Website Redesign',
            hours: 4,
            date: '2024-01-15',
            description: 'Test',
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.project_id).toBeNull();
      expect(result.error).toBe('Project could not be identified');
    });

    it('should reject negative hours', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: -2,
            date: '2024-01-15',
            description: 'Test',
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.hours).toBeNull();
      expect(result.error).toBe('Hours could not be extracted');
    });

    it('should reject zero hours', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 0,
            date: '2024-01-15',
            description: 'Test',
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.hours).toBeNull();
    });

    it('should clamp confidence values above 1', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4,
            date: '2024-01-15',
            description: 'Test',
            confidence: 1.5
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.confidence).toBe(1);
    });

    it('should clamp confidence values below 0', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4,
            date: '2024-01-15',
            description: 'Test',
            confidence: -0.5
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.confidence).toBe(0);
    });

    it('should use original text as description when description is empty', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4,
            date: '2024-01-15',
            description: '',
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const originalText = '4 hours on Website Redesign doing work';
      const result = await parserService.parseText(originalText, mockProjects);

      expect(result.description).toBe(originalText);
    });

    it('should handle missing project_name field', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: null,
            hours: 4,
            date: '2024-01-15',
            description: 'Test',
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.project_name).toBeNull();
    });
  });

  describe('validateDate', () => {
    it('should accept valid date format', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4,
            date: '2024-12-25',
            description: 'Test',
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.date).toBe('2024-12-25');
    });

    it('should reject invalid date format', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4,
            date: '25-12-2024',
            description: 'Test',
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.date).toBeNull();
      expect(result.error).toBe('Date could not be determined');
    });

    it('should reject invalid date values', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4,
            date: '2024-13-01',
            description: 'Test',
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.date).toBeNull();
    });

    it('should reject malformed date string', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4,
            date: 'not-a-date',
            description: 'Test',
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.date).toBeNull();
    });

    it('should accept leap year date', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4,
            date: '2024-02-29',
            description: 'Test',
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.date).toBe('2024-02-29');
    });

    it('should handle null date', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4,
            date: null,
            description: 'Test',
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.date).toBeNull();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long descriptions', async () => {
      const longDescription = 'A'.repeat(10000);

      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4,
            date: '2024-01-15',
            description: longDescription,
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.description).toBe(longDescription);
    });

    it('should handle special characters in description', async () => {
      const specialDescription = 'Work with "quotes", \'apostrophes\', <html>, & symbols, and emojis 😊';

      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4,
            date: '2024-01-15',
            description: specialDescription,
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.description).toContain('quotes');
    });

    it('should handle decimal hours', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 3.75,
            date: '2024-01-15',
            description: 'Test',
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.hours).toBe(3.75);
    });

    it('should handle projects without codes', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 4,
            project_name: 'API Integration',
            hours: 5,
            date: '2024-01-15',
            description: 'Test',
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('5 hours on API Integration', mockProjects);

      expect(result.project_id).toBe(4);
      expect(result.project_name).toBe('API Integration');
    });

    it('should handle concurrent parse requests', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4,
            date: '2024-01-15',
            description: 'Test',
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const promises = [
        parserService.parseText('Request 1', mockProjects),
        parserService.parseText('Request 2', mockProjects),
        parserService.parseText('Request 3', mockProjects)
      ];

      const results = await Promise.all(promises);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.project_id).toBe(1);
      });
    });

    it('should handle extremely short user input', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: null,
            project_name: null,
            hours: null,
            date: null,
            description: 'work',
            confidence: 0.1
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('work', mockProjects);

      expect(result.description).toBe('work');
      expect(result.confidence).toBe(0.1);
    });

    it('should handle multiline user input', async () => {
      const multilineInput = `I worked on Website Redesign
For about 4 hours
Doing homepage updates`;

      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 4,
            date: '2024-01-15',
            description: multilineInput,
            confidence: 0.9
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText(multilineInput, mockProjects);

      expect(result.description).toContain('homepage updates');
    });
  });

  describe('Error Scenarios', () => {
    it('should handle network timeout to AI service', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Request timeout'));

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.error).toBe('Request timeout');
      expect(result.confidence).toBe(0);
    });

    it('should handle AI service rate limiting', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).status = 429;

      mockGenerateContent.mockRejectedValue(rateLimitError);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.error).toBe('Rate limit exceeded');
    });

    it('should handle malformed JSON response', async () => {
      const mockResponse = {
        response: {
          text: () => '{"project_id": 1, "hours": 4' // Incomplete JSON
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.error).toBe('Invalid response format from AI');
    });

    it('should handle response with unexpected data types', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 'not-a-number',
            hours: 'not-a-number',
            date: 20240115,
            description: ['array', 'instead', 'of', 'string'],
            confidence: 'high'
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.project_id).toBeNull();
      expect(result.hours).toBeNull();
      expect(result.confidence).toBe(0);
    });

    it('should handle AI service returning 500 error', async () => {
      mockGenerateContent.mockRejectedValue(new Error('Internal server error'));

      const result = await parserService.parseText('Test', mockProjects);

      expect(result.error).toBe('Internal server error');
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle realistic timesheet entry', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 2,
            project_name: 'Mobile App Development',
            hours: 6.5,
            date: '2024-01-15',
            description: 'Implemented user authentication and profile management features',
            confidence: 0.92
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText(
        'I spent 6.5 hours today working on the MOB project. I implemented user authentication and profile management features.',
        mockProjects
      );

      expect(result.project_id).toBe(2);
      expect(result.hours).toBe(6.5);
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('should handle ambiguous project reference', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: null,
            project_name: null,
            hours: 3,
            date: '2024-01-15',
            description: 'the website project',
            confidence: 0.5
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText(
        'I spent 3 hours on the website project',
        mockProjects
      );

      expect(result.project_id).toBeNull();
      expect(result.error).toBe('Project could not be identified');
    });

    it('should handle entry with all required information', async () => {
      const mockResponse = {
        response: {
          text: () => JSON.stringify({
            project_id: 1,
            project_name: 'Website Redesign',
            hours: 5,
            date: '2024-01-15',
            description: 'Completed homepage redesign and responsive layout',
            confidence: 0.98
          })
        }
      };

      mockGenerateContent.mockResolvedValue(mockResponse);

      const result = await parserService.parseText(
        '5 hours on Website Redesign (WEB) - Completed homepage redesign and responsive layout',
        mockProjects
      );

      expect(result.error).toBeUndefined();
      expect(result.confidence).toBe(0.98);
    });
  });
});
