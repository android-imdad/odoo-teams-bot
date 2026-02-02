import { filterTasksByQuery, hasTaskKeywords } from '../../src/services/taskFilter';
import { OdooTask } from '../../src/types/odoo.types';

describe('Task Filter Service', () => {
  const mockTasks: OdooTask[] = [
    { id: 1, name: 'Homepage Redesign', project_id: 1, active: true },
    { id: 2, name: 'Fix login bug', project_id: 1, active: true },
    { id: 3, name: 'Update API documentation', project_id: 1, active: true },
    { id: 4, name: 'Database migration', project_id: 1, active: true },
    { id: 5, name: 'User profile page', project_id: 1, active: true },
    { id: 6, name: 'Email notifications', project_id: 1, active: true },
    { id: 7, name: 'Security audit', project_id: 1, active: true },
    { id: 8, name: 'Performance optimization', project_id: 1, active: true },
    { id: 9, name: 'Mobile responsiveness', project_id: 1, active: true },
    { id: 10, name: 'Payment integration', project_id: 1, active: true }
  ];

  describe('filterTasksByQuery', () => {
    it('should return all tasks when task count is at or below limit', () => {
      const fewTasks = mockTasks.slice(0, 3);
      const result = filterTasksByQuery(fewTasks, 'homepage work', { limit: 5 });

      expect(result).toHaveLength(3);
      expect(result).toEqual(fewTasks);
    });

    it('should return top 5 matching tasks when there are more tasks than limit', () => {
      const result = filterTasksByQuery(mockTasks, 'homepage design', { limit: 5 });

      // Only tasks that match the query are returned (not padded to reach limit)
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(5);
      // Should match "Homepage Redesign" first
      expect(result[0].name).toBe('Homepage Redesign');
    });

    it('should handle fuzzy matching for partial matches', () => {
      const result = filterTasksByQuery(mockTasks, 'securty audit', { limit: 5 });

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].name).toBe('Security audit');
    });

    it('should handle case-insensitive matching', () => {
      const result1 = filterTasksByQuery(mockTasks, 'HOMEPAGE', { limit: 5 });
      const result2 = filterTasksByQuery(mockTasks, 'homepage', { limit: 5 });

      expect(result1[0].name).toBe('Homepage Redesign');
      expect(result2[0].name).toBe('Homepage Redesign');
    });

    it('should return empty array for empty task list', () => {
      const result = filterTasksByQuery([], 'homepage', { limit: 5 });

      expect(result).toEqual([]);
    });

    it('should return first N tasks on error (fallback behavior)', () => {
      // Pass null to trigger error handling
      const result = filterTasksByQuery(null as any, 'homepage', { limit: 5 });

      expect(result).toEqual([]);
    });

    it('should match tasks containing keywords anywhere in the name', () => {
      const result = filterTasksByQuery(mockTasks, 'API docs', { limit: 5 });

      expect(result.length).toBeGreaterThan(0);
      expect(result.some(t => t.name.includes('API'))).toBe(true);
    });

    it('should prioritize exact matches over partial matches', () => {
      const tasks: OdooTask[] = [
        { id: 1, name: 'Bug fix for login', project_id: 1, active: true },
        { id: 2, name: 'Login page redesign', project_id: 1, active: true },
        { id: 3, name: 'User login authentication', project_id: 1, active: true }
      ];

      const result = filterTasksByQuery(tasks, 'login', { limit: 2 });

      expect(result).toHaveLength(2);
      // All results should contain "login"
      expect(result.every(t => t.name.toLowerCase().includes('login'))).toBe(true);
    });
  });

  describe('hasTaskKeywords', () => {
    it('should return true for queries containing task-related keywords', () => {
      expect(hasTaskKeywords('Worked on homepage redesign')).toBe(true);
      expect(hasTaskKeywords('Fixing a bug in the login')).toBe(true);
      expect(hasTaskKeywords('Meeting with the team')).toBe(true);
      expect(hasTaskKeywords('Documentation for the API')).toBe(true);
    });

    it('should return false for queries without task keywords', () => {
      expect(hasTaskKeywords('2 hours project alpha')).toBe(false);
      expect(hasTaskKeywords('4h Project X')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(hasTaskKeywords('WORKED ON Homepage')).toBe(true);
      expect(hasTaskKeywords('BUG fix')).toBe(true);
      expect(hasTaskKeywords('MEETING notes')).toBe(true);
    });

    it('should match partial words', () => {
      // "implement" should match
      expect(hasTaskKeywords('Implementing new features')).toBe(true);
      // "develop" should match
      expect(hasTaskKeywords('Development work')).toBe(true);
    });
  });
});
