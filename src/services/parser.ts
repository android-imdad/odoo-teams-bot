import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/config';
import { logger } from '../config/logger';
import { ParsedTimesheetData } from '../types';
import { OdooProject, OdooTask } from '../types/odoo.types';
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
    projectList: OdooProject[],
    taskList: OdooTask[] = []
  ): Promise<ParsedTimesheetData> {
    try {
      logger.info('Parsing timesheet text', { userText, projectCount: projectList.length, taskCount: taskList.length });

      const today = format(new Date(), 'yyyy-MM-dd');
      const projectListStr = projectList
        .map(p => `- ID: ${p.id}, Name: "${p.name}"${p.code ? `, Code: "${p.code}"` : ''}`)
        .join('\n');

      const taskListStr = taskList.length > 0
        ? taskList
            .map(t => `- ID: ${t.id}, Name: "${t.name}", Project ID: ${t.project_id}`)
            .join('\n')
        : 'No tasks available for the selected project.';

      const prompt = `You are a timesheet entry parser. Extract structured data from the user's natural language input.

Available Projects:
${projectListStr}

Available Tasks (for identified project):
${taskListStr}

Today's Date: ${today}

User Input: "${userText}"

Instructions:
1. Identify the project from the available projects list based on name or code mentioned
2. Check if user wants to create a NEW task (look for phrases like "create task", "new task", "add task", "make task")
3. If creating a new task, extract the new task name from the user's input
4. If NOT creating a new task, try to identify an existing task from the available tasks list
5. Extract the number of hours worked (support formats: "4 hours", "4h", "4.5 hours", etc.)
6. Determine the date (if not mentioned, use today: ${today}). Support formats like "yesterday", "last Friday", specific dates
7. Extract the work description/task details (separate from task name when creating new tasks)

Output ONLY a valid JSON object with this exact structure (no additional text):
{
  "project_id": <number or null>,
  "project_name": "<string or null>",
  "task_id": <number or null>,
  "task_name": "<string or null>,
  "create_new_task": <true or false>,
  "new_task_name": "<string or null - the name of the new task if create_new_task is true>",
  "hours": <number or null>,
  "date": "<YYYY-MM-DD or null>",
  "description": "<string>",
  "confidence": <number between 0-1>
}

Rules:
- If project cannot be identified with certainty, set project_id and project_name to null
- If user explicitly says they want to create a new task (e.g., "create task Homepage Redesign"), set create_new_task to true and extract new_task_name
- If create_new_task is true, set task_id and task_name to null (task doesn't exist yet)
- If create_new_task is false and task cannot be identified, set task_id and task_name to null (timesheets can be logged without a task)
- If hours cannot be extracted, set to null
- If date cannot be determined, set to null (not today)
- Always include the full description
- Confidence should reflect how certain you are about the extraction (1.0 = very certain)
- Date must be in YYYY-MM-DD format
- Task matching should consider that users may refer to tasks by partial name matches
- Example: "4 hours on Website project creating new task Homepage Redesign, fixing the header" → create_new_task: true, new_task_name: "Homepage Redesign", description: "fixing the header"`;

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
        task_id: null,
        task_name: null,
        create_new_task: false,
        new_task_name: null,
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
      task_id: typeof data.task_id === 'number' ? data.task_id : null,
      task_name: data.task_name || null,
      hours: typeof data.hours === 'number' && data.hours > 0 ? data.hours : null,
      date: this.validateDate(data.date),
      description: data.description || originalText,
      confidence: typeof data.confidence === 'number'
        ? Math.max(0, Math.min(1, data.confidence))
        : 0,
      create_new_task: data.create_new_task === true,
      new_task_name: data.new_task_name || null
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
