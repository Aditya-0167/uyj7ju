// Generates the REAL bwrap argument list via the actual, unmodified
// buildBwrapArgs() export from packages/core/src/sandbox/linux/bwrapArgsBuilder.ts,
// for a plain, ordinary command with no special policy configuration --
// the common case for a user who has enabled security.toolSandboxing.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const checkout = process.env.GEMINI_CLI_CHECKOUT;
if (!checkout) {
  console.error('GEMINI_CLI_CHECKOUT env var not set.');
  process.exit(1);
}

const mod = await import(
  pathToFileURL(path.join(checkout, 'packages/core/src/sandbox/linux/bwrapArgsBuilder.ts')).href
);

const workspace = process.env.VICTIM_WORKSPACE;
if (!workspace) {
  console.error('VICTIM_WORKSPACE env var not set.');
  process.exit(1);
}

const resolvedPaths = {
  workspace: { original: workspace, resolved: workspace },
  forbidden: [], // nothing in .geminiignore for this test -- the ordinary case
  globalIncludes: [],
  policyAllowed: [],
  policyRead: [],
  policyWrite: [],
  gitWorktree: undefined,
};

const args = await mod.buildBwrapArgs({
  resolvedPaths,
  workspaceWrite: true,
  networkAccess: false,
  maskFilePath: '/tmp/fake-mask',
  isReadOnlyCommand: false,
});

console.log(JSON.stringify(args));
