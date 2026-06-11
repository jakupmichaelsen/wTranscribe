import { chromium } from '@playwright/test';

const AUDIO_FILE = '/home/jakup/Downloads/Camilla (2).mp3';

const context = await chromium.launchPersistentContext('/home/jakup/Transcription/word-profile', {
  headless: false,
  viewport: null,
  locale: 'en-GB',
  args: [
    '--lang=en-GB',
    '--disable-session-crashed-bubble',
    '--disable-infobars',
    '--no-first-run',
    '--no-default-browser-check',
    '--restore-last-session=false',
  ],
});
let page = context.pages()[0];

if (!page) {
  page = await context.newPage();
}

// Close extra restored tabs, but keep one page.
for (const p of context.pages()) {
  if (p !== page) {
    await p.close();
  }
}

page.setDefaultTimeout(60000);

async function wait(ms) {
  await page.waitForTimeout(ms);
}

async function findFrameByLocator(makeLocator, timeout = 60000) {
  const start = Date.now();

  while (Date.now() - start < timeout) {
    for (const frame of page.frames()) {
      try {
        const locator = makeLocator(frame);
        if (await locator.count()) {
          const first = locator.first();
          if (await first.isVisible({ timeout: 1000 }).catch(() => false)) {
            return frame;
          }
        }
      } catch {
        // Ignore frames that are not ready or not accessible yet.
      }
    }

    await page.waitForTimeout(1000);
  }

  throw new Error('Could not find matching frame.');
}

async function clickIfVisible(locator, timeout = 5000) {
  try {
    await locator.click({ timeout });
    return true;
  } catch {
    return false;
  }
}

// 1. Open a fresh Word document.
await page.goto('https://word.new');
await wait(12000);

// 2. Find the main Word frame.
const wordFrame = page.frameLocator('iframe[name="WacFrame_Word_0"]');

await wordFrame.locator('#WACViewPanel_EditingElement').waitFor({
  state: 'visible',
  timeout: 60000,
});

await wordFrame.locator('#WACViewPanel_EditingElement').click();

// 3. Open Dictate > Transcribe.
await wordFrame
.getByRole('button', { name: /Dictate/i })
.click();

await wordFrame
.getByRole('menuitemradio', { name: /Transcribe/i })
.click();

await wait(7000);

// 4. Find the Transcribe iframe dynamically.
// It may contain "Upload audio", "Start recording", or the language selector.
let transcribeFrame = await findFrameByLocator(
  (frame) =>
  frame
  .getByRole('button', { name: /Upload audio/i })
  .or(frame.getByText(/English \(United Kingdom\)/i))
  .or(frame.getByText(/English \(United States\)/i))
  .or(frame.getByText(/Danish \(Denmark\)/i)),
                                               60000
);

// 5. Set transcription language.
// This part is defensive: it only changes language if the selector is visible.
const languageDropdown = transcribeFrame.getByText(/English \(United Kingdom\)|English \(United States\)|Danish \(Denmark\)/i).first();

if (await languageDropdown.isVisible({ timeout: 10000 }).catch(() => false)) {
  await languageDropdown.click();

  // Choose English US. Change this if you prefer another language.
  const englishUS = transcribeFrame.getByRole('option', { name: /English \(United States\)/i });

  if (await englishUS.isVisible({ timeout: 10000 }).catch(() => false)) {
    await englishUS.click();
  } else {
    // If the option list appears in another frame, search for it globally.
    const optionFrame = await findFrameByLocator(
      (frame) => frame.getByRole('option', { name: /English \(United States\)/i }),
                                                 10000
    ).catch(() => null);

    if (optionFrame) {
      await optionFrame.getByRole('option', { name: /English \(United States\)/i }).click();
    }
  }
}

await wait(2000);

// 6. Re-find the Transcribe iframe after changing language.
// Office sometimes rerenders the pane.
transcribeFrame = await findFrameByLocator(
  (frame) => frame.getByRole('button', { name: /Upload audio/i }),
                                           60000
);

// 7. Upload audio.
await transcribeFrame
.getByRole('button', { name: /Upload audio/i })
.click();

await wait(2000);

// This #container selector came from your recording.
// It may be the hidden file input/dropzone used by the Transcribe pane.
await transcribeFrame
.locator('#container')
.setInputFiles(AUDIO_FILE);

// 8. Wait for transcription to finish.
// Adjust this depending on audio length.
await wait(90000);

// 9. Find and click "Add to document".
// The pane may rerender again after transcription, so search globally.
const addFrame = await findFrameByLocator(
  (frame) => frame.getByRole('button', { name: /Add to document/i }),
                                          180000
);

await addFrame
.getByRole('button', { name: /Add to document/i })
.click();

console.log('Done. Browser left open for inspection.');
