import fs from 'fs';

const sourceFile = 'transcribe.spec.js';
const outputFile = 'run-transcribe.mjs';

if (!fs.existsSync(sourceFile)) {
  console.error(`Missing ${sourceFile}. First run: npm run record`);
  process.exit(1);
}

const recorded = fs.readFileSync(sourceFile, 'utf8').split('\n');

// Remove:
// import { test, expect } from '@playwright/test';
// test('test', async ({ page }) => {
// ...final });
const body = recorded
  .slice(3)
  .join('\n')
  .replace(/\n\s*\}\);\s*$/s, '');

const runner = `import { chromium } from '@playwright/test';

const context = await chromium.launchPersistentContext('${process.cwd()}/word-profile', {
  headless: false,
  viewport: null,
  locale: 'en-GB',
  args: ['--lang=en-GB'],
});

// Use the first existing page from the persistent profile.
// Do not close all pages first; that can make Chromium unable to open a new tab.
let page = context.pages()[0];

if (!page) {
  page = await context.newPage();
}

// Close extra restored tabs, but keep the page we will use.
for (const p of context.pages()) {
  if (p !== page) {
    await p.close();
  }
}

${body}

// Browser is left open for inspection.
// Close it manually when finished.
`;

fs.writeFileSync(outputFile, runner);
console.log(`Built ${outputFile} from ${sourceFile}`);
