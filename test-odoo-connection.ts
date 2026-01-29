/**
 * Real Odoo Connection Test
 * This script tests the actual connection to your Odoo instance
 */

import { OdooService } from './src/services/odoo';
import { config } from './src/config/config';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m'
};

async function testOdooConnection() {
  console.log(`${colors.blue}=== Odoo Connection Test ===${colors.reset}\n`);

  // Display configuration
  console.log(`${colors.yellow}Configuration:${colors.reset}`);
  console.log(`  URL:      ${config.odoo.url}`);
  console.log(`  Database: ${config.odoo.db}`);
  console.log(`  Username: ${config.odoo.username}`);
  console.log(`  Password: ${'*'.repeat(config.odoo.password.length)}\n`);

  const odooService = new OdooService(config.odoo);
  let testsPassed = 0;
  let testsFailed = 0;

  // Test 1: Authentication
  console.log(`${colors.blue}[1/3] Testing authentication...${colors.reset}`);
  try {
    const uid = await (odooService as any).authenticate();
    console.log(`${colors.green}✓ Authentication successful!${colors.reset}`);
    console.log(`  User ID: ${uid}\n`);
    testsPassed++;
  } catch (error: any) {
    console.log(`${colors.red}✗ Authentication failed:${colors.reset}`);
    console.log(`  ${error.message}\n`);
    testsFailed++;
    return; // Stop here if auth fails
  }

  // Test 2: Get Projects
  console.log(`${colors.blue}[2/3] Fetching projects...${colors.reset}`);
  try {
    const projects = await odooService.getProjects();
    console.log(`${colors.green}✓ Projects fetched successfully!${colors.reset}`);
    console.log(`  Found ${projects.length} project(s)\n`);

    if (projects.length > 0) {
      console.log(`${colors.yellow}Available Projects:${colors.reset}`);
      projects.forEach((p, i) => {
        console.log(`  ${i + 1}. [${p.id}] ${p.name} ${p.code ? `(${p.code})` : ''}`);
      });
      console.log('');
    } else {
      console.log(`${colors.yellow}⚠ No projects found in Odoo${colors.reset}\n`);
    }
    testsPassed++;
  } catch (error: any) {
    console.log(`${colors.red}✗ Failed to fetch projects:${colors.reset}`);
    console.log(`  ${error.message}\n`);
    testsFailed++;
  }

  // Test 3: Create Test Timesheet (only if we have projects)
  console.log(`${colors.blue}[3/3] Testing timesheet creation...${colors.reset}`);
  try {
    const projects = await odooService.getProjects();
    if (projects.length === 0) {
      console.log(`${colors.yellow}⊘ Skipped - No projects available${colors.reset}\n`);
    } else {
      const testEntry = {
        project_id: projects[0].id,
        project_name: projects[0].name,
        hours: 0.25,
        date: new Date().toISOString().split('T')[0],
        description: 'Test entry from Odoo Teams Bot connection test'
      };

      const timesheetId = await odooService.logTime(testEntry);
      console.log(`${colors.green}✓ Test timesheet created!${colors.reset}`);
      console.log(`  Timesheet ID: ${timesheetId}`);
      console.log(`  ${colors.yellow}Please verify in Odoo dashboard${colors.reset}\n`);
      testsPassed++;
    }
  } catch (error: any) {
    console.log(`${colors.red}✗ Failed to create test timesheet:${colors.reset}`);
    console.log(`  ${error.message}\n`);
    testsFailed++;
  }

  // Summary
  console.log(`${colors.blue}=== Test Summary ===${colors.reset}`);
  console.log(`  ${colors.green}Passed: ${testsPassed}${colors.reset}`);
  console.log(`  ${colors.red}Failed: ${testsFailed}${colors.reset}`);
  console.log('');

  if (testsFailed === 0) {
    console.log(`${colors.green}All tests passed! Odoo connection is working.${colors.reset}`);
  } else {
    console.log(`${colors.red}Some tests failed. Check the errors above.${colors.reset}`);
  }

  process.exit(testsFailed === 0 ? 0 : 1);
}

testOdooConnection().catch((error) => {
  console.error(`${colors.red}Unexpected error:${colors.reset}`, error);
  process.exit(1);
});
