# Gate file format

A gate ledger is a machine-checked completion contract. The checker and Stop hook use the same strict parser. Invalid structure fails closed instead of producing a completion certificate.

## Minimal format

```markdown
# Gates: account import

OWNS: src/import/**, tests/import/**

Scope: import valid records and reject malformed records

- [ ] G1: valid fixture imports completely
  CHECK: node scripts/check-import.mjs fixtures/valid.json
  EXPECT: import verification passed
  EVIDENCE: pending

- [ ] G2: package-level integration succeeds
  CHECK: node ../../scripts/check-package.mjs
  EXPECT: package verification passed
  CWD: packages/importer
  EVIDENCE: pending

- [ ] G3: migration wording is reviewed against the product decision
  EVIDENCE: pending

ABANDON: G3 decision owner unavailable; handoff recorded in issue 123
```

The fenced example above is documentation. Lines inside fenced code blocks are ignored by the parser. Fence boundaries follow [CommonMark's fenced-code rules](https://spec.commonmark.org/0.30/#fenced-code-blocks): the closing marker uses the same character, is at least as long as the opener, has no trailing content, and may have up to three leading spaces.

## Strict parsing rules

- Start a gate with `- [ ] ID: outcome` or `- [x] ID: outcome`. Use a non-empty explicit id that is unique within the file. An id-less gate is malformed because line-derived identifiers are not stable when lines move.
- Indent `CHECK:`, `EXPECT:`, `CWD:`, the optional `CACHE: no`, and `EVIDENCE:` beneath their gate. An unindented attribute is diagnosed instead of silently changing the gate into a manual one.
- Give a runnable gate both `CHECK:` and `EXPECT:`. Give a manual gate neither. A partial runnable gate is malformed.
- Use one `EVIDENCE:` line per gate. If it is omitted from an otherwise valid gate, the checker inserts it without changing the file's original CRLF or LF newline style.
- Put the optional `OWNS:` header before the first gate. Separate paths with commas. Paths are repository-relative globs; absolute paths and traversal segments such as `..` are invalid.
- Write `ABANDON: <id> <reason>` only for a gate in the same file. The reason must contain non-whitespace text. An unknown id is a parse error, because silently ignoring a typo could let an otherwise green child promote its parent.
- Start `ABANDON:` at column 1. It names its gate by id, so it is a file-level statement rather than a gate attribute, and it is the one line that must not be indented. An indented `ABANDON:` is diagnosed rather than applied.
- Do not define a ledger with zero gates. A named empty or malformed ledger is a parse error, not `ALL MET`.
- Use `/pattern/flags` for a JavaScript regular-expression expectation or plain text for a substring. An invalid regular expression is a parse error.
- Remember that the wrapping slashes always win. `EXPECT: /etc/app/conf/` is the pattern `etc/app/conf`, not that literal path, so its dots match any character. An unescaped inner slash is warned because both readings are plausible. Escape the inner slashes to keep the pattern, or drop the wrapping slashes and match a distinctive substring such as `etc/app/conf`.

Ids are unique within one file. Tools qualify them with the file stem in tree-wide output, such as `leaf-1.2.1:G3` or `node-1.1:N2`. Use the qualified form in reports and handoffs.

## Success and evidence

A runnable gate passes only when both conditions hold:

1. The process starts and exits with status `0`.
2. `EXPECT:` matches the command's combined standard output and standard error.

A nonzero process never passes merely because its error text contains the expected token. A hang, shell-start error, or missing command also fails. A check has no time limit and no output limit: it may run and print for as long as it likes. It is stopped only when it is hung, meaning it printed nothing and its whole process tree did no CPU or I/O work for `KEEL_SILENCE_MS` (default 30 minutes, minimum 1000); that result is red with the message `HUNG`. `--timeout` is still accepted so existing calls keep working, but it is ignored and says so on stderr (the notice appears only when `--timeout` was passed, and not when `KEEL_GATE_QUIET_TIMEOUT` is set). A deliberately detached process may outlive a hung shell because unlazy is not a process sandbox; checks must clean up any background services they intentionally detach. The output of a check is written to files in a private work directory outside the repository (removed when the run ends), and EXPECT is checked on those files: text block by block with overlap, so a match across a block boundary is found, and a regular expression on the whole content. The result keeps the length and SHA-256 of the output, not its text. Regular-expression matching uses at most four disposable workers; each gets a five-second startup limit before its separate 250ms match budget begins (an output of 8 MiB or more gets 250ms more per further 8 MiB, up to 60 seconds, and a regular expression cannot scan an output beyond the V8 string limit of about 512 MiB).

Before the first check of a package run, gate-check looks for an open package amendment (`<harness root>/.unlazy/.amend/*.json`, the Harness root being the repository or an ancestor holding `.keel-harness.json`). The repository and the package id come from each ledger file itself (the Git worktree of the file, then `docs/packages/<id>/` below it), never from the working directory or `--root`, so an absolute file path from outside the repository or a foreign `--root` does not get around the check. If one names a package of this run it stops with `AMEND_OPEN` and the commands that finish or undo the amendment; it runs and writes nothing, because the ticks and EVIDENCE it would write make the amendment impossible to finish. A record that cannot be assigned safely to another package or repository (broken JSON, not a regular file, unknown `schemaVersion`, missing fields) stops the run the same way with `AMEND_UNCLEAR` and names the file. Git has three answers: a worktree root, an explicit "not a git repository" (exit 128; the file cannot be named by any record and is skipped), and a failed probe (git not on `PATH`, a timeout, `safe.directory`, any other exit). A failed probe is never read as "no repository": a ledger file below `docs/packages/<id>/`, or below a directory that holds `.unlazy/.amend` records, then stops the run with `AMEND_UNCLEAR`, naming the file and the reason; any other file goes on with a warning. The write of each ledger repeats the check for exactly that file under its file lock and refuses the write (exit 2, `AMEND_OPEN` or `AMEND_UNCLEAR`) when an amendment opened while the checks ran.

Evidence records the resolved shell, resolved working directory, exit status, a short `PATH` hash and entry count, the successful match, and a SHA-256/byte-count fingerprint of combined output. The pre-execution transcript prints the resolved `PATH`, capped at 800 characters for display; evidence avoids persisting the full machine-specific value or raw successful output. Failure diagnostics are bounded, terminal-only, and control-stripped. This makes an environment mismatch visible and prevents a success token from hiding a process failure. A checked gate whose evidence is absent or still `pending` remains unmet.

Package-bundle evidence is deliberately portable. It persists `shellId`, a
repository-relative `cwd`, exit/match facts, and the output
digest/byte count; it never persists an absolute repository, home, shell, or
approval path. The approval token binds the ledger and resolved CWD by their
path inside the repository (approvals made earlier with the absolute path stay
valid), the resolved shell, full PATH, and every other machine-local oracle input.

## Results per code state (`--at`)

`--at <commit>` checks the code of one commit instead of the working copy; it works only in a package run (`--package`). The `CHECK:`s of one run share one clean copy of that commit (one `git worktree add --detach` below the system temp directory, removed once after the last gate), so uncommitted and untracked files of the working copy are never seen. `--at` implies `--reverify`: a gate that is ticked in the ledger is checked like any other. Every `--tree` entry must name a file or directory of the commit in its exact spelling (also its case); an entry that names nothing is a usage error. A `node_modules` the commit cannot hold is linked into the copy (a junction on Windows) only where the `package-lock.json` of the commit is byte-identical, as a Git object, to the one in the working copy; the links are removed before the copy, so the real `node_modules` is never touched. If such a `node_modules` holds a link (top level or inside an `@scope` folder) whose target lies in the working tree of the repository outside any `node_modules` (a workspace or `file:` dependency), the copy would read uncommitted code through it: the run says `PROOF_NOT_CACHEABLE` and its results are neither stored nor reused.

A green result is stored on the commit as a Git note of ref `keel-proof`, one compact JSON entry per line (`{"schema":"keel-proof.v2-entry","key":...}`), so that `proof-notes-sync` (which merges notes with `cat_sort_uniq`, line by line) keeps the entries of both sides; entries of the same key are joined, and notes of the older one-document form (`keel-proof.v1`) are still read. It is written only through the Harness's own `git-intent proof-note-write`, which is looked for next to the checker only (`<repo>/vendor/unlazy/scripts` -> `<repo>/test-harness/harness-core/git/git-intent.mjs`, `<harness>/vendor/unlazy/scripts` -> `<harness>/harness-core/git/git-intent.mjs`), never in the checked repository. Its key covers the code state of the commit below `--tree` (default: the whole repository; Git objects, so line endings and the repository path do not matter; ticks, `EVIDENCE:`, `## Status` and `## Abschluss` of package files are normalized away), the exact `CHECK:` and `EXPECT:`, the `CWD:` inside the repository, the shell id, the Node version, every `package-lock.json` in scope and the checker that runs (`gate-check.mjs` and `lib/`, from its bytes with line endings unified). A checker that lives in the checked repository and differs from the commit's (changed and not committed) says `PROOF_NOT_CACHEABLE`; its results are neither stored nor reused. Whoever meets the same key again on that commit or a first-parent descendant gets the gate green with `PROOF_REUSED <key prefix>` and nothing runs. Red results are never stored, and neither are gates marked `CACHE: no` or commands that reach a model, the network or an install (`claude-fanout-e2e`, `codex-plugin-e2e`, `codex-runtime-smoke`, `npm ci`, `npm install`, `curl `, `gh `, `--live`, `KEEL_LIVE`). A tick or an `EVIDENCE:` line in the text is never a proof for `--at`. Without the Harness's git-intent (plain unlazy) results are made in the clean copy but neither stored nor reused.

EVIDENCE written by `--at` carries `proof=<16 key characters>@<commit>`. When a gate is already met under the same key, the ledger is not written again; a changed output hash alone is no reason to rewrite it.

`--status` parses and reports historical ledger state without executing a command or changing a file. It does not inspect current artifacts or revalidate old evidence, and the Stop hook has the same non-executing boundary. Use `--reverify` for parent verification: it executes every runnable gate, including gates already checked, and returns a gate to unmet when the oracle no longer passes. Its summary reports both all commands rerun and the subset that had previously been met.

## Approval boundary

`CHECK:` is executable shell code with the permissions and inherited environment of the checker. Parse inherited ledgers with `--status` and read their source. A normal run without an existing approval prints each resolved oracle and leaves it unexecuted. Execute only with explicit `--approve` after reviewing every command and called script.

Approval records live under `~/.unlazy/approved` by default. `UNLAZY_APPROVAL_DIR` can select another directory only when it is a real, owner-private directory whose canonical target stays outside the canonical repository root. Symlinked stores and linked, replaced, or non-private records fail closed. The approval identity includes the absolute ledger and gate, exact `CHECK:` and `EXPECT:`, resolved `CWD:` and shell, regex limits (a time or output limit is not part of the key, and approvals made with one stay valid), regex worker limits, platform, and full inherited `PATH`. In a package run (`--package`) the ledger and `CWD:` are bound by their path inside the repository instead, so an approval also holds in another checkout of the same repository (for example the clean copy of `--at`); approvals recorded earlier with the absolute path stay valid. Changing any listed input invalidates approval. Approval deliberately does not hash called scripts, fixtures, source files, dependencies, or other transitive inputs. A byte change to those files can therefore run under an existing approval, and old green evidence can remain visible in `--status` until explicit re-verification. Reinspect changed dependencies and run `--reverify`. If machine-enforced dependency identity is required, put expected digests in approval-bound `CHECK:` text and validate them with a separately trusted tool/runtime; that is user-designed coverage, not transitive tracing by unlazy. Approval confirms that a command may run; it does not prove that the command measures the English outcome. See [../SECURITY.md](../SECURITY.md) for the full threat model.

On Windows, POSIX mode bits are not evidence of privacy. Before an approved
oracle executes, unlazy invokes only the absolute System32 Windows PowerShell
helper derived from mutually consistent `SystemRoot`, `WINDIR`, and
`SystemDrive` values. The .NET ACL check requires the current user to own the
store and rejects write-capable allow rules for untrusted SIDs. Missing,
unresolvable, or unsafe ACL evidence is an infrastructure error (exit `2`), and
the `CHECK:` is not started. Status and lint remain non-executing.

## Shell, PATH, and working directory

The checker resolves its shell in this order:

1. `--shell <path-or-name>`
2. `UNLAZY_SHELL`
3. `/bin/sh` on Unix, or `process.env.ComSpec` on Windows with `cmd.exe` as the fallback name

The child process inherits the checker's environment, including `PATH`. Node documents that shell commands use the platform shell and inherited environment; Microsoft documents that `cmd.exe` searches the current directory and then `PATH` for executable extensions. Launching the checker from Git Bash can therefore expose tools that the same command launched from PowerShell does not. A shell override changes the interpreter, not the installed programs or inherited `PATH`.

Prefer repository-owned Node scripts in portable gates:

```markdown
  CHECK: node scripts/verify-output.mjs
  EXPECT: output verification passed
```

Do not assume stock Windows provides `grep`, `tail`, `tr`, `sed`, or POSIX pipeline behavior. If a gate intentionally needs a particular shell or external tool, declare that prerequisite and use the same shell and toolchain during parent re-verification.

`CWD:` is resolved relative to the checker's default working directory. Set that default with `--cwd`. Without `--cwd`, explicitly named ledgers anchor beside that ledger, while scoped and legacy discovery anchor at `--root`. Keep `CWD:` repository-relative. The resolved directory is part of both evidence and approval.

Primary platform references:

- [Node.js child process documentation](https://nodejs.org/api/child_process.html#child_processexeccommand-options-callback)
- [Microsoft `path` documentation](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/path)

## Author gates that can fail

The checker validates a declared oracle. It cannot infer whether unrestricted English and unrestricted shell code mean the same thing. `G1: invoices reconcile` plus `CHECK: node -e "console.log('ok')"` is syntactically valid and semantically useless.

- **Observe the outcome directly.** Make the check read the artifact, service, or measurement named by the title.
- **Emit a success-only marker.** Let the script perform all assertions, exit nonzero on any failure, and print the expected marker only after every assertion passes.
- **Test negative controls.** Before trusting an absence check, run the same logic against a known positive fixture and confirm that it fails. A missing file, wrong path, or malformed pattern can otherwise look like valid absence.
- **Measure supplied numbers independently.** Do not make a number copied from the brief its own expectation. Make the script calculate the value from source data, apply the acceptance rule, and print a separate success marker.
- **Review consequential manual gates by risk.** A contributor's single 17-gate course audit found that its only manual gate was also its most consequential. Use that observation as a prompt for stronger review, not as evidence of a general correlation between checkability and risk. Cite exact evidence and obtain a second review when the consequence warrants it.
- **Keep evidence decisive.** Automated successful evidence stores an output fingerprint, not raw output. For manual gates, record the smallest non-sensitive fact that proves the outcome; do not paste full logs into a ledger.

### Lint the ledger before working it

The rules above are prose, and prose is the layer this project already treats as weakest. `gate-lint.mjs` makes the mechanical subset of them checkable. It never executes a `CHECK:`; it reads the ledger and judges its oracles.

```text
node scripts/gate-lint.mjs GATES.md
node scripts/gate-lint.mjs --strict --json docs/packages/<packageId>/gates/leaf-1.1.1.md
```

Warnings are deliberately advisory lexical signals: a whole command that looks like a fixed-output emitter, an expectation drawn from vocabulary that failure output also uses, a slash-wrapped path-shaped regular expression, a title that names an activity rather than an outcome, a number that nothing measures, or a mostly manual ledger. The linter does not shell-parse commands, and neither a command prefix nor EXPECT text appearing in argv proves that an oracle cannot fail.

Default warnings print details plus `LINT OK (<N> warning(s))` and exit `0`, so the self-gate below remains useful without making every advisory fatal. `--strict` prints `LINT FINDINGS`, exits `1`, and emits no `LINT OK` marker. Exit `2` is a usage or shared-parser failure. A lint finding is a prompt to sharpen the gate, not proof that the outcome is wrong.

Make a ledger require its own quality by linting as a gate:

```markdown
- [ ] G0: this ledger states outcomes that can fail
  CHECK: node scripts/gate-lint.mjs GATES.md
  EXPECT: LINT OK
  EVIDENCE: pending
```

## Abandonment

Use abandonment only when a required outcome is genuinely impossible within the authorized task. Keep the original gate, add one non-empty reason, and name the abandonment in the final report. An abandonment is a terminal visible handoff, not a passing check: `gate-check` prints `HANDOFF REQUIRED` and exits `1` even when every non-abandoned gate is met. The Stop hook allows the session to end but emits a bounded handoff message containing qualified ids, not free-form reasons. Never promote an abandoned child through a parent `ALL MET` oracle or describe the task as fully complete.

## Concurrency

Use `OWNS:` only as part of the coordination protocol in [parallel.md](parallel.md). It does not restrict a command's filesystem access. Concurrent leaves must declare disjoint paths, claim them before dispatch, and release them after verification.
