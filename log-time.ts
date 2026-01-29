/**
 * Quick script to log time to a specific project
 */

import { OdooService } from './src/services/odoo';
import { config } from './src/config/config';

async function logTimeToProject() {
  const odooService = new OdooService(config.odoo);

  const entry = {
    project_id: 2,  // SSI project
    project_name: 'SSI',
    hours: 1.5,
    date: new Date().toISOString().split('T')[0],
    description: 'Test timesheet entry logged via script'
  };

  console.log('Logging time to SSI project...');
  console.log(`  Hours: ${entry.hours}`);
  console.log(`  Description: ${entry.description}`);
  console.log(`  Date: ${entry.date}\n`);

  try {
    const timesheetId = await odooService.logTime(entry);
    console.log(`✅ Timesheet created successfully!`);
    console.log(`   Timesheet ID: ${timesheetId}`);
    console.log(`   Verify at: https://spacewalk.odoo.com`);
  } catch (error: any) {
    console.error(`❌ Failed to create timesheet: ${error.message}`);
  }
}

logTimeToProject();
