import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/config';
import { logger } from '../config/logger';
import { ParsedTimesheetData } from '../types';
import { OdooProject } from '../types/odoo.types';
import { format } from 'date-fns';

export class ParserService {
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    // Use v1beta API for preview models - SDK appends /v1beta automatically
    const requestOptions = config.gemini.model.includes('preview') || config.gemini.model.includes('2.5')
      ? { baseUrl: 'https://generativelanguage.googleapis.com' }
      : undefined;
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    this.model = this.genAI.getGenerativeModel(
      { model: config.gemini.model },
      requestOptions
    );
    logger.info('ParserService initialized', { model: config.gemini.model, apiVersion: requestOptions ? 'v1beta' : 'v1' });
  }

  /**
   * Parse natural language timesheet text using Gemini
   */
  async parseText(
    userText: string,
    projectList: OdooProject[]
  ): Promise<ParsedTimesheetData> {
    try {
      logger.info('Parsing timesheet text', { userText, projectCount: projectList.length });

      const today = format(new Date(), 'yyyy-MM-dd');
      const projectListStr = projectList
        .map(p => `- ID: ${p.id}, Name: "${p.name}"${p.code ? `, Code: "${p.code}"` : ''}`)
        .join('\n');

      const prompt = `You are a timesheet entry parser. Extract structured data from the user's natural language input.

Available Projects:
${projectListStr}

Today's Date: ${today}

User Input: "${userText}"

Instructions:
1. Identify the project from the available projects list based on name or code mentioned
2. Extract the number of hours worked (support formats: "4 hours", "4h", "4.5 hours", etc.)
3. Determine the date (if not mentioned, use today: ${today}). Support formats like "yesterday", "last Friday", specific dates
4. Extract the work description/task details

Output ONLY a valid JSON object with this exact structure (no additional text):
{
  "project_id": <number or null>,
  "project_name": "<string or null>",
  "hours": <number or null>,
  "date": "<YYYY-MM-DD or null>",
  "description": "<string>",
  "confidence": <number between 0-1>
}

Rules:
- If project cannot be identified with certainty, set project_id and project_name to null
- If hours cannot be extracted, set to null
- If date cannot be determined, set to null (not today)
- Always include the full description
- Confidence should reflect how certain you are about the extraction (1.0 = very certain)
- Date must be in YYYY-MM-DD format`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      logger.debug('Gemini raw response', { response: text });

      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.error('Failed to extract JSON from Gemini response', { response: text });
        throw new Error('Invalid response format from AI');
      }

      const parsed: ParsedTimesheetData = JSON.parse(jsonMatch[0]);

      // Validate and sanitize the parsed data
      const validated = this.validateParsedData(parsed, userText);

      logger.info('Timesheet parsed successfully', { parsed: validated });
      return validated;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to parse timesheet text', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined, userText });

      // Return a safe fallback response
      return {
        project_id: null,
        project_name: null,
        hours: null,
        date: null,
        description: userText,
        confidence: 0,
        error: error instanceof Error ? error.message : 'Unknown parsing error'
      };
    }
  }

  /**
   * Validate and sanitize parsed data
   */
  private validateParsedData(
    data: ParsedTimesheetData,
    originalText: string
  ): ParsedTimesheetData {
    const validated: ParsedTimesheetData = {
      project_id: typeof data.project_id === 'number' ? data.project_id : null,
      project_name: data.project_name || null,
      hours: typeof data.hours === 'number' && data.hours > 0 ? data.hours : null,
      date: this.validateDate(data.date),
      description: data.description || originalText,
      confidence: typeof data.confidence === 'number'
        ? Math.max(0, Math.min(1, data.confidence))
        : 0
    };

    // Add validation warnings
    if (!validated.project_id) {
      validated.error = 'Project could not be identified';
    } else if (!validated.hours) {
      validated.error = 'Hours could not be extracted';
    } else if (!validated.date) {
      validated.error = 'Date could not be determined';
    }

    return validated;
  }

  /**
   * Validate date format (YYYY-MM-DD)
   */
  private validateDate(date: string | null): string | null {
    if (!date) return null;

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      logger.warn('Invalid date format', { date });
      return null;
    }

    // Check if date is valid
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) {
      logger.warn('Invalid date value', { date });
      return null;
    }

    return date;
  }
}

// Export singleton instance
export const parserService = new ParserService();
