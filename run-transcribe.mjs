import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);

const HEADLESS = args.includes('--headless');

const AUDIO_FILE = args.find((arg) => !arg.startsWith('--'));

if (!AUDIO_FILE) {
  console.error('Usage: node run-transcribe.mjs [--headless] "/path/to/audio-file.mp3"');
  process.exit(1);
}

if (!fs.existsSync(AUDIO_FILE)) {
  console.error(`Audio file not found: ${AUDIO_FILE}`);
  process.exit(1);
}

const PROFILE_DIR = '/home/jakup/Transcription/word-profile';
const OUTPUT_DIR = '/home/jakup/Transcription';

// Change to /Danish \(Denmark\)/i if needed.
const TRANSCRIPTION_LANGUAGE = /English \(United States\)/i;

// Set to false while debugging.
const CLOSE_BROWSER_WHEN_DONE = true;

function disableCrashRestore(profileDir) {
  const candidates = [
    path.join(profileDir, 'Default', 'Preferences'),
    path.join(profileDir, 'Preferences'),
  ];

  for (const prefPath of candidates) {
    if (!fs.existsSync(prefPath)) continue;

    try {
      const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf8'));

      prefs.profile = prefs.profile ?? {};
      prefs.profile.exit_type = 'Normal';
      prefs.profile.exited_cleanly = true;

      prefs.session = prefs.session ?? {};
      prefs.session.restore_on_startup = 0;

      prefs.browser = prefs.browser ?? {};
      prefs.browser.has_seen_welcome_page = true;

      fs.writeFileSync(prefPath, JSON.stringify(prefs, null, 2));
      console.log(`Updated Chromium preferences: ${prefPath}`);
    } catch (err) {
      console.log(`Could not update Chromium preferences at ${prefPath}: ${err.message}`);
    }
  }
}

disableCrashRestore(PROFILE_DIR);

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: HEADLESS,
  viewport: null,
  locale: 'en-GB',
  slowMo: HEADLESS ? 0 : 350,
  acceptDownloads: true,
  args: [
    '--lang=en-GB',
    '--disable-session-crashed-bubble',
    '--disable-infobars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=InfiniteSessionRestore',
  ],
});

let page = context.pages()[0];

if (!page) {
  page = await context.newPage();
}

// Close extra restored tabs, but keep one usable page.
for (const p of context.pages()) {
  if (p !== page) {
    await p.close().catch(() => {});
  }
}

page.setDefaultTimeout(60000);

async function sleep(ms) {
  await page.waitForTimeout(ms);
}

async function dismissChromeRestorePopup() {
  console.log('Dismissing possible Chromium restore popup...');

  await page.keyboard.press('Escape').catch(() => {});
  await sleep(500);

  // The "Restore pages?" bubble is browser UI, not page DOM.
  // This aims near its X button.
  try {
    const viewport = page.viewportSize();
    if (viewport) {
      await page.mouse.click(viewport.width - 35, 135);
      await sleep(500);
    }
  } catch {}

  await page.keyboard.press('Escape').catch(() => {});
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
        // Ignore frames that are not ready or accessible yet.
      }
    }

    await sleep(1000);
  }

  throw new Error('Could not find matching frame.');
}

async function clickVisible(locator, label, timeout = 60000) {
  console.log(`Waiting for: ${label}`);
  await locator.waitFor({ state: 'visible', timeout });
  await locator.scrollIntoViewIfNeeded().catch(() => {});

  console.log(`Clicking: ${label}`);
  await locator.click({ force: true });
}

try {
  await dismissChromeRestorePopup();

  console.log('Opening word.new...');
  await page.goto('https://word.new', { waitUntil: 'domcontentloaded' });

  await dismissChromeRestorePopup();

  console.log('Finding main Word frame...');
  const wordFrame = page.frameLocator('iframe[name="WacFrame_Word_0"]');

  console.log('Waiting for editable Word document...');
  const editingArea = wordFrame.locator('#WACViewPanel_EditingElement');

  await editingArea.waitFor({
    state: 'visible',
    timeout: 120000,
  });

  console.log('Clicking document body...');
  await editingArea.click({ force: true });

  console.log('Opening Dictate menu...');
  const dictateButton = wordFrame.getByRole('button', {
    name: 'Dictate Show More Options',
  });

  await clickVisible(dictateButton, 'Dictate Show More Options button', 90000);

  console.log('Opening Transcribe pane...');
  const transcribeMenuItem = wordFrame.getByRole('menuitemradio', {
    name: /Transcribe/i,
  });

  await clickVisible(transcribeMenuItem, 'Transcribe menu item', 60000);

  console.log('Finding Transcribe pane frame...');
  let transcribeFrame = await findFrameByLocator(
    (frame) =>
    frame
    .getByRole('button', { name: /Upload audio/i })
    .or(frame.getByText(/English \(United Kingdom\)/i))
    .or(frame.getByText(/English \(United States\)/i))
    .or(frame.getByText(/Danish \(Denmark\)/i))
    .or(frame.getByText(/Start recording/i)),
                                                 120000
  );

  console.log('Transcribe frame found.');

  console.log('Checking language dropdown...');
  const languageDropdown = transcribeFrame
  .getByText(/English \(United Kingdom\)|English \(United States\)|Danish \(Denmark\)/i)
  .first();

  if (await languageDropdown.isVisible({ timeout: 10000 }).catch(() => false)) {
    console.log('Opening language dropdown...');
    await languageDropdown.click({ force: true });

    console.log(`Selecting transcription language: ${TRANSCRIPTION_LANGUAGE}`);

    const languageOptionSameFrame = transcribeFrame.getByRole('option', {
      name: TRANSCRIPTION_LANGUAGE,
    });

    if (await languageOptionSameFrame.isVisible({ timeout: 5000 }).catch(() => false)) {
      await languageOptionSameFrame.click({ force: true });
    } else {
      const optionFrame = await findFrameByLocator(
        (frame) => frame.getByRole('option', { name: TRANSCRIPTION_LANGUAGE }),
                                                   15000
      ).catch(() => null);

      if (optionFrame) {
        await optionFrame
        .getByRole('option', { name: TRANSCRIPTION_LANGUAGE })
        .click({ force: true });
      } else {
        console.log('Could not find requested language option; continuing with current language.');
      }
    }
  } else {
    console.log('Language dropdown not visible; continuing.');
  }

  console.log('Re-finding Transcribe pane after possible rerender...');
  transcribeFrame = await findFrameByLocator(
    (frame) => frame.getByRole('button', { name: /Upload audio/i }),
                                             120000
  );

  console.log('Clicking Upload audio and handling file chooser...');
  const uploadButton = transcribeFrame.getByRole('button', { name: /Upload audio/i });

  await uploadButton.waitFor({ state: 'visible', timeout: 90000 });

  const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 30000 });

  await uploadButton.click({ force: true });

  const fileChooser = await fileChooserPromise;

  console.log(`Uploading audio file: ${AUDIO_FILE}`);
  await fileChooser.setFiles(AUDIO_FILE);

  console.log('Audio file submitted. Waiting for Add to document button...');
  const addFrame = await findFrameByLocator(
    (frame) => frame.getByRole('button', { name: /Add to document/i }),
                                            20 * 60 * 1000
  );

  console.log('Opening Add to document menu...');
  await addFrame
  .getByRole('button', { name: /Add to document/i })
  .click({ force: true });

  console.log('Choosing With timestamps...');
  const timestampFrame = await findFrameByLocator(
    (frame) =>
    frame
    .getByText('With timestamps', { exact: true })
    .or(frame.getByRole('menuitem', { name: /With timestamps/i })),
                                                  60000
  );

  const timestampOption = timestampFrame.getByText('With timestamps', { exact: true });

  if (await timestampOption.isVisible({ timeout: 5000 }).catch(() => false)) {
    await timestampOption.click({ force: true });
  } else {
    await timestampFrame
    .getByRole('menuitem', { name: /With timestamps/i })
    .click({ force: true });
  }

  console.log('Transcript inserted with timestamps.');

  // Give Word a moment to insert/save the transcript before exporting.
  await sleep(5000);

  console.log('Opening File menu...');
  const fileButtonExact = wordFrame.getByRole('button', {
    name: 'File',
    exact: true,
  });

  if (await fileButtonExact.isVisible({ timeout: 5000 }).catch(() => false)) {
    await fileButtonExact.click({ force: true });
  } else {
    await wordFrame
    .getByRole('button', { name: /File/i })
    .first()
    .click({ force: true });
  }

  console.log('Waiting for Export menu item...');
  const exportMenuItem = wordFrame.getByText('Export', { exact: true });

  await exportMenuItem.waitFor({ state: 'visible', timeout: 30000 });

  console.log('Opening Export submenu...');
  await exportMenuItem.hover();

  console.log('Waiting for Download as ODT option...');
  const odtOption = wordFrame.getByText('Download as ODT', { exact: true });

  await odtOption.waitFor({ state: 'visible', timeout: 30000 });

  console.log('Choosing Download as ODT...');
  await odtOption.click({ force: true });

  console.log('Waiting for Download confirmation button...');
  const downloadButton = wordFrame.getByRole('button', { name: /^Download$/i });

  await downloadButton.waitFor({ state: 'visible', timeout: 60000 });

  console.log('Waiting for ODT download...');
  const downloadPromise = page.waitForEvent('download', { timeout: 120000 });
  const popupPromise = page.waitForEvent('popup', { timeout: 120000 }).catch(() => null);

  await downloadButton.click({ force: true });

  const popup = await popupPromise;
  const download = await downloadPromise;

  const suggested = download.suggestedFilename();
  const outputPath = path.join(OUTPUT_DIR, suggested);

  await download.saveAs(outputPath);

  console.log(`Saved ODT to: ${outputPath}`);

  if (popup) {
    await popup.close().catch(() => {});
  }

  if (CLOSE_BROWSER_WHEN_DONE) {
    console.log('Closing browser cleanly...');
    await context.close();
  } else {
    console.log('Done. Browser left open for inspection.');
  }

  console.log('Done.');
} catch (err) {
  console.error('Automation failed:');
  console.error(err);

  console.log('Browser left open for inspection after failure.');
  console.log('Set CLOSE_BROWSER_WHEN_DONE=false while debugging if needed.');

  throw err;
}
