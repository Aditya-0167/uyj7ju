// Confirms, by reading the real checked-out source (not by assertion),
// that gemini-cli's macOS Seatbelt implementation of the identical
// "Tool sandboxing" feature uses a default-deny policy with file reads
// explicitly scoped to the workspace -- the correct behavior that the
// Linux bwrap implementation (tested above) does not provide.
import fs from 'node:fs';
import path from 'node:path';

const checkout = process.argv[2];
if (!checkout) {
  console.error('Usage: node compare_macos_source.mjs <gemini-cli-checkout-path>');
  process.exit(1);
}

const baseProfileSrc = fs.readFileSync(
  path.join(checkout, 'packages/core/src/sandbox/macos/baseProfile.ts'),
  'utf8',
);
const seatbeltBuilderSrc = fs.readFileSync(
  path.join(checkout, 'packages/core/src/sandbox/macos/seatbeltArgsBuilder.ts'),
  'utf8',
);

console.log('Checking real baseProfile.ts for default-deny policy...');
const hasDenyDefault = baseProfileSrc.includes('(deny default)');
const hasDenyDefaultComment = baseProfileSrc.includes('strict allowlist (deny default)');
console.log('  contains literal "(deny default)":', hasDenyDefault);
console.log('  contains the file\'s own comment describing this as "strict allowlist (deny default)":', hasDenyDefaultComment);

console.log();
console.log('Checking real seatbeltArgsBuilder.ts for workspace-scoped read allow rules...');
const hasWorkspaceReadAllow = seatbeltBuilderSrc.includes(
  "profile += `(allow file-read* (subpath \\\"${escapeSchemeString(resolvedPaths.workspace.original)}\\\"))",
) || /allow file-read\* \(subpath.*resolvedPaths\.workspace\.original/.test(seatbeltBuilderSrc);
console.log('  explicit (allow file-read* (subpath <workspace>)) rule present:', hasWorkspaceReadAllow);

const hasBlanketReadAllow = /allow file-read\*\s*\(subpath\s*"\/"\)/.test(seatbeltBuilderSrc)
  || /allow file-read-data\*?\s*\(subpath\s*"\/"\)/.test(seatbeltBuilderSrc);
console.log('  any blanket "(allow file-read* (subpath "/"))" rule present (would mean unrestricted, like Linux):', hasBlanketReadAllow);

console.log();
console.log('=== VERDICT ===');
if (hasDenyDefault && hasDenyDefaultComment && hasWorkspaceReadAllow && !hasBlanketReadAllow) {
  console.log('CONFIRMED: the real macOS source uses default-deny with reads explicitly');
  console.log('scoped to the workspace (plus other specific allowlisted paths, e.g. for');
  console.log('basic process execution) -- no blanket root-filesystem read allowance.');
  console.log('This is the correct behavior. Linux\'s bwrap-based implementation, tested');
  console.log('above with real execution, does not have this restriction: it binds the');
  console.log('entire filesystem read-only unconditionally.');
} else {
  console.log('NOT CONFIRMED as expected -- re-check manually, the source may have changed.');
  process.exit(1);
}
