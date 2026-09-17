Summary: gemini-cli: Linux "Tool sandboxing" (bwrap) does not confine file reads to the workspace, contradicting documentation and the project's own correct macOS implementation (bwrapArgsBuilder.ts)

Program: Cloud VRP

URL: https://github.com/google-gemini/gemini-cli/blob/9c1b0a610534d6f8120964cf2672c07807d8fc90/packages/core/src/sandbox/linux/bwrapArgsBuilder.ts

Vulnerability type: Sandbox Escape (confidentiality; read-only escape, not write/code-exec)

## Details

### Vulnerability Description

gemini-cli has a "Tool sandboxing" feature (`security.toolSandboxing` setting) that isolates individual shell-command executions rather than the whole CLI process. On Linux, this is implemented via `bubblewrap` (`bwrap`), with the sandbox arguments built by `buildBwrapArgs()`.

The real, unmodified function unconditionally includes:

```
--ro-bind / /
```

This read-only bind-mounts the **entire host root filesystem** into the sandbox. The only path-masking mechanism (`resolvedPaths.forbidden`) is populated exclusively from `.geminiignore` patterns (`Config.getSandboxForbiddenPaths()` → `getFileService().getIgnoredPaths(...)`), a project-scoped content-privacy feature, not a host-security control -- it has no relationship to system paths like `~/.ssh`, `~/.aws`, or GCP credential files. Separately, a `.env`/`.env.*` file-masking pass (`getSecretFileFindArgs()`) only searches within the workspace and a small set of explicitly-configured directories, again never reaching arbitrary host paths outside them.

This contradicts the project's own documentation, `docs/cli/sandbox.md`, which states verbatim: **"By default, the sandbox only has access to the current project workspace."** Escaping this requires the user to explicitly opt in via `SANDBOX_MOUNTS` for anything outside the workspace -- which the bwrap implementation does not honor as a boundary at all, since everything is already exposed unconditionally.

**This is a confirmed regression relative to the project's own established pattern, not a novel oversight in isolation.** The codebase already contains a purpose-built function, `isSensitiveHostPath()` (`packages/cli/src/utils/sandboxUtils.ts`), whose own comment states it "protects ~/.gemini, user home directories, and sensitive credential files from being accessed or poisoned." It is used at 11 call sites in the older, separate, whole-process container-based sandbox (`packages/cli/src/utils/sandbox.ts`, Docker/Podman/Seatbelt/gVisor/LXC) -- and zero times anywhere in the newer bwrap-based "Tool sandboxing" code path.

**Stronger still: the project's own macOS implementation of this identical feature does it correctly.** `packages/core/src/sandbox/macos/baseProfile.ts`'s own comment states: *"This uses a strict allowlist (deny default)"* -- and the profile literally begins with `(deny default)`. `seatbeltArgsBuilder.ts` then only explicitly allows file reads via `(allow file-read* (subpath "<workspace>"))` plus a small number of specific, necessary paths (system frameworks for process execution, `/tmp`, git dirs, node root, explicitly policy-allowed paths) -- there is no blanket root-filesystem read allowance anywhere in it. Same feature, same codebase, two platforms: macOS correctly confines reads to the workspace by default; Linux does not.

The write path is correctly restricted on Linux (verified in the PoC: an attempted write outside the workspace fails with "Read-only file system"). This is specifically a **read-confidentiality** gap, not a write or code-execution one.

**This also silently defeats the tool's own purpose-built safety prompt for this exact scenario.** `packages/core/src/tools/shell.ts`'s `shouldConfirmExecute()` only surfaces a "Sandbox Expansion Request" confirmation when a command needs *more* filesystem access than the sandbox currently grants (`missingRead`/`missingWrite` checks against `approved.fileSystem.read`/`write`, ~lines 332-427). Because the broken sandbox configuration already grants read access to the entire filesystem, the code correctly concludes -- from its own incorrect premise -- that a command reading e.g. `~/.ssh/id_rsa` needs no additional permission, so this specific confirmation never fires. This is traced through the real source (not independently re-executed as a second live test, unlike the core finding above), but it's a direct, mechanical consequence of the already-proven bug: the one UI mechanism purpose-built to flag "this command wants sensitive file access" is itself defeated by the same root cause.

### Attack Preconditions

- The user must have `security.toolSandboxing: true` set (default is `false`, confirmed in both `packages/core/src/config/config.ts` and `packages/cli/src/config/settingsSchema.ts`). This is a real, honest limiting factor: it is a separate, less-commonly-used opt-in setting, not the default state, and not the same as the widely-documented `-s`/`GEMINI_SANDBOX=true` flag (which activates a completely different, older, Docker/Podman-based whole-process sandbox via `packages/cli/src/utils/sandbox.ts` -- confirmed by tracing `createSandboxManager()`, which only instantiates `LinuxSandboxManager` when `sandbox.enabled` is true, itself derived from `params.sandbox.enabled || params.toolSandboxing`).
- Linux host (this report; have not verified whether Windows' `WindowsSandboxManager` has an equivalent issue).
- A shell command needs to execute inside the sandbox that reads a file outside the workspace -- this could be a user-run command, or (a broader concern) a model-suggested command influenced by content the model read, including untrusted/attacker-controlled repository content, given shell commands in this tool are frequently LLM-generated rather than user-typed verbatim.
- The attacker needs to know or guess the target file's path on the host -- common, predictable locations (`~/.ssh/id_rsa`, `~/.aws/credentials`, `~/.config/gcloud/...`) apply once the home directory is known, which is often the case in CI/single-user container deployments.

### Reproduction Steps / POC

Target: google-gemini/gemini-cli, commit 9c1b0a610534d6f8120964cf2672c07807d8fc90

Self-contained: clones the pinned commit fresh, installs the real `bubblewrap` binary, generates the real sandbox arguments via the actual unmodified `buildBwrapArgs()` export, and **actually executes real `bwrap`** with those exact arguments (not a simulation or verbatim-copy stand-in -- this one runs the genuine sandbox binary).

    bash poc/run_poc.sh

This:
1. Confirms the exact documented sentence ("By default, the sandbox only has access to the current project workspace") is still present in `docs/cli/sandbox.md`, so the claim being tested against is verified, not assumed.
2. Generates the real argument list from `buildBwrapArgs()` for an ordinary command with no special configuration -- the common case.
3. Executes real `bwrap` with those exact arguments: `cat /root/victim-home/.ssh/id_rsa` (a file completely outside the sandboxed workspace) -- succeeds, prints the full simulated key content. As a control, an attempted write to that same file inside the same sandbox invocation is correctly blocked ("Read-only file system"), confirming this is specifically a read-confinement gap.
4. Programmatically confirms (by reading the real checked-out source, not by assertion) that the macOS implementation of this identical feature uses `(deny default)` with reads explicitly scoped to the workspace, and contains no blanket root-filesystem read allowance -- establishing the cross-platform inconsistency concretely.

Captured output from an actual run, plus a GitHub Actions workflow (`.github/workflows/verify-poc.yml`) that re-runs the full chain (including a real `bwrap` install and execution) on a fresh Ubuntu runner for independent confirmation, are both in the attached zip.

### Attack scenario

A user who has opted into `security.toolSandboxing` for defense-in-depth around shell command execution gets materially less protection than documented: any command executed through the sandbox -- including one a model was steered into running via prompt injection from untrusted content -- can read any file the host OS user can read, anywhere on the filesystem, with no restriction beyond `.geminiignore`-scoped project files and workspace-local `.env` patterns. This defeats the read-confidentiality half of the sandbox's stated purpose while leaving the write-confinement half intact.

I can't verify from the open-source repository alone what fraction of real users enable `security.toolSandboxing`, or how commonly untrusted repository content reaches shell-command generation in practice -- flagging both as real, honest boundaries on how broadly this applies, not asserting specific numbers.

### Suggested remediation

- Replace the unconditional `--ro-bind / /` with an allowlist model mirroring the macOS implementation: bind only the workspace, required system paths for process execution (`/usr`, `/lib`, etc. as needed), `/tmp`, and any explicitly policy-allowed paths -- deny everything else by default.
- At minimum, apply `isSensitiveHostPath()` (or an equivalent check) to the Linux bwrap path the same way it's already applied 11 times in the Docker-based sandbox, so this specific class of path (home directory, `~/.gemini`, credential files) is protected even if a full allowlist rework isn't immediately feasible.
