# FW Mem Guard Action — release preparation

Intended repository: `itainover-create/fw-mem-guard-action`. This directory is the
complete public wrapper source, with `action.yml` at its root. No private engine
source belongs in this repository. No public tag or Marketplace listing is claimed.

Requires a Linux x64 runner capable of running the Action's Node 24 runtime.
The CLI target is glibc 2.28+; Rocky Linux 8 acceptance is a release gate.

After compiling firmware and restoring a reviewed baseline, use the Action pinned
to the full reviewed commit SHA in its dedicated repository. Set `project` to the
saved `.fwmg.json` file. The default CLI version is 0.3.7.

Inputs:
- `project`: workspace-relative project, default `firmware.fwmg.json`.
- `version`: exact version present in `releases.json`; no floating versions.
- `cli-archive`: optional original CLI tar.gz, absolute or workspace-relative.
  When provided, the Action performs no network requests. Missing or invalid files
  fail without downloading a replacement. Provision the Action and runner too;
  this option alone does not make GitHub Actions completely air-gapped.
- `report`: new workspace-relative JSON file, default `fwmg-result.json`.
- `fail-on-budget-exceeded`: `true` by default; `false` permits budget warnings
  only. Invalid inputs, downloads, JSON and execution failures still fail.

Outputs: `result` is `pass`, `budget-exceeded` or `error`; `exit-code` is the CLI
outcome (0, 2, 1), even when warning-only returns success. `report-path` is emitted
only after valid JSON has been written. Missing outputs must never be treated as
PASS: runner/runtime failures can occur before this code starts.

`stderr` diagnostics do not override a valid exit code and matching JSON result.
Full reports may contain object paths; no report is uploaded automatically.

Downloads use a direct GitHub Releases URL, never the Releases API. Firewalls must
permit GitHub's release-download redirects as well. Both paths check the archive
against the SHA-256 in this Action's source before safe extraction and execution.
For enforcement do not use `continue-on-error`; make the job a required check.

## Maintainer release gates

1. Create the dedicated public repository before any public Action tag.
2. Pass native CLI compatibility and actual packaged comparisons on Rocky 8 and
   Ubuntu 24.04; retain provenance, ABI report and artifact SHA-256.
3. Preserve the reviewed archive digest in `releases.json`. Version 0.3.7 is pinned
   to the archive from private workflow run 38200827611, commit
   0c68b6f84a24396102b4ce7c533c108f21d72cdd. Rocky 8 and Ubuntu acceptance passed.
   The public download is pending; the offline archive path is ready.
4. Run `node --test test.js` and the private real-CLI smoke test against the same
   original archive. Never rebuild after approving its digest.
5. Publish the reviewed compiled CLI and checksum in the product release repo.
6. Test the actual download, then tag the dedicated wrapper and publish the Action
   listing. Update examples to a real full commit SHA, not an invented placeholder.

Only wrapper code is MIT-licensed. Downloaded binaries retain their own license.

## Public-download acceptance and publication script

The private development repository now tracks `scripts/publish-action-release.ps1`
for owner review. `Publish` verifies the input archive against this source's
`releases.json`, publishes to the exact repository/tag used by `releaseAsset`,
downloads the public bytes and rechecks SHA-256, then dispatches
`.github/workflows/public-acceptance.yml`. It never accepts a license agreement.

That workflow uses the pinned, licensed MicroPython sample and actual downloaded
CLI to test PASS, budget failure, warning-only, restored PASS and input error.
`Tag` requires its successful run ID at the current Action main commit, the exact
CLI version/digest in its log, and another successful public hash check before
creating the Action's release/tag. Marketplace registration remains a separate
website step, including two-factor authentication and the developer agreement.

The original 0.3.7 archive is pinned and passed offline native acceptance with
Node 22 and 24, including the real Zephyr +256-byte attribution case.
Public download acceptance remains pending until the owner publishes the release.
