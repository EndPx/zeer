#!/usr/bin/env node
import {fileURLToPath} from 'node:url';

try {
  // Run Chef's real entry point in this process, retaining its terminal,
  // cancellation and sanitized error handling. No shell or second process.
  const entry = new URL('./cli.js', import.meta.resolve('@zeer-dev/chef'));
  process.argv[1] = fileURLToPath(entry);
  await import(entry.href);
} catch {
  console.error(JSON.stringify({error: {code: 'ZEER_CLI_UNAVAILABLE'}, help: 'Could not load the packaged Chef CLI. Check your Node version and reinstall the requested Zeer release.'}));
  process.exitCode = 1;
}
