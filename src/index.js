
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
const { runAgent } = require('./agent/agent');
const logger = require('./utils/logger');


const TASK = `
Navigate to the shadcn/ui React Hook Form documentation page.
Find the interactive form example which has fields for:
  1. Username
  2. Bug Title (if present)
  3. Description

Fill them with realistic sample data:
  - Username: Mohit Sagar
  - Bug Title: UI Component Bug Report
  - Description: Dropdown loses focus when scrolling inside a modal. Seen in Firefox 120+ and Chrome 119+.

Click the Submit button and confirm the form was submitted successfully.
Take screenshots at each important step.
`.trim();


(async () => {
  try {
    await runAgent({
      task: TASK,
      targetUrl: process.env.TARGET_URL || 'https://ui.shadcn.com/docs/forms/react-hook-form',
      useAI: true
    });

    process.exit(0);
  } catch (err) {
    logger.error('Fatal error in agent:', err);
    process.exit(1);
  }
})();
