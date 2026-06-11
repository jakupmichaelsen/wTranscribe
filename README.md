# wTranscribe

Playwright-based transcription automation for Word.

## Requirements

- Node.js
- Playwright installed through `npm install`

## Commands

```bash
npm run auth
```

Open a Playwright codegen session against Microsoft Office using the `word-profile` browser profile. Use this first if you need to log in.

```bash
npm run record
```

Record a new script with Playwright codegen and write it to `transcribe.spec.js`.

```bash
npm run build-runner
```

Build the runner script.

```bash
npm run run
```

Run `run-transcribe.mjs`.

```bash
npm run rerun
```

Rebuild the runner and run it in one step.
