# FW Mem Guard Action

Compare GNU Arm ELF/MAP firmware builds in CI, including verified Zephyr v3.7.0 `qemu_cortex_m3` and MicroPython v1.24.1 `NUCLEO_F411RE` examples. Enforce Flash/RAM usage and growth budgets before merging firmware changes.

Catch firmware Flash and RAM budget regressions in GitHub Actions using a saved
`.fwmg.json` project.

[GitHub Marketplace](https://github.com/marketplace/actions/fw-mem-guard-firmware-memory-budgets)
 · [Action v0.3.7 preview](https://github.com/itainover-create/fw-mem-guard-action/releases/tag/v0.3.7)
 · [Linux CLI download](https://github.com/itainover-create/fw-mem-guard/releases/tag/v0.3.7)
 · [Documentation](https://itainover-create.github.io/fw-mem-guard/)

## Quick start

Set up and review a project with FW Mem Guard first. Commit its `.fwmg.json` file
and provision the baseline and current firmware files in your workflow, preserving
the paths recorded in the project. Compile the current firmware before this step.

```yaml
permissions:
  contents: read

jobs:
  memory-budget:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      # Add your firmware build and baseline retrieval steps here.
      - name: Check firmware memory budgets
        id: memory
        uses: itainover-create/fw-mem-guard-action@a96092596041597a687c335dbaa90d5ed6ede5a7 # v0.3.7
        with:
          project: firmware.fwmg.json
          version: 0.3.7
```

The Action downloads the compiled CLI from the public release and verifies its
SHA-256 against the value pinned in the Action source before extraction and
execution. Pin the Action to the full commit SHA for reproducible CI.

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `project` | `firmware.fwmg.json` | Existing workspace-relative project file. |
| `version` | `0.3.7` | Exact CLI version present in `releases.json`. |
| `cli-archive` | unset | Optional original CLI tar.gz, absolute or workspace-relative. |
| `report` | `fwmg-result.json` | New workspace-relative JSON report; existing files are not overwritten. |
| `fail-on-budget-exceeded` | `true` | Set `false` to warn on budget violations while still failing on errors. |

For warning-only adoption, add `fail-on-budget-exceeded: 'false'` under `with`.
A budget violation then produces a GitHub warning and a workflow summary while
retaining `result=budget-exceeded` and CLI `exit-code=2`. Infrastructure and input
errors still fail. For enforcement, keep the default and make the job a required
check; do not use `continue-on-error` to suppress failures.

## Outputs

| Output | Values |
| --- | --- |
| `result` | `pass`, `budget-exceeded`, or `error` |
| `exit-code` | CLI result: `0` PASS, `2` budget exceeded, `1` error |
| `report-path` | Absolute path of the validated JSON report, when available |

Missing outputs must not be interpreted as PASS: runner/runtime failures can
occur before the Action starts. Diagnostics on stderr do not override an otherwise
valid CLI result. Full reports can include object paths and are not uploaded
automatically.

## Offline CLI provisioning

Download the original `fw-mem-guard-0.3.7-linux-x64.tar.gz` and place it on the
runner. Set `cli-archive` to that file. The same pinned digest is checked before
extraction, and this path makes no CLI-download network requests. An invalid local
archive fails without falling back to a download. Provision the Action source,
runner and firmware dependencies separately for a disconnected environment.

## Compatibility and validation

- Linux x64 runner capable of executing the Action's Node 24 runtime; glibc 2.28+
  and the runtime's libstdc++ dependencies. Archive extraction uses tar and gzip.
  The Action uses its own Node runtime; no setup-node step is required.
- Complete GNU ld MAP files paired with matching ARM ELF32 little-endian firmware.
  This is firmware analysis, not analysis of Linux application executables.
- The compiled CLI passed offline Rocky Linux 8 and Ubuntu 24.04 acceptance with
  Node 22 and 24. The Action itself uses Node 24.
- Real firmware validation includes MicroPython and Zephyr 3.7.0 qemu_cortex_m3,
  including a controlled +256-byte RAM change attributed to its source object.
  nRF Connect SDK, STM32CubeIDE and MCUXpresso-specific validation is still pending.

[Public-download acceptance](https://github.com/itainover-create/fw-mem-guard-action/actions/runs/38305734028)
passed on the exact v0.3.7 commit: pinned public archive, real MicroPython PASS,
budget exit 2, warning-only, restored PASS and input-error handling.

The Action is currently a pre-release. Its published tag and approved CLI bytes
remain unchanged when documentation on main is updated.

## License and privacy

This repository contains only the MIT-licensed orchestration wrapper. The
compiled CLI retains its own license; private engine source is not included.
Memory comparison runs locally on the runner. Downloads use direct GitHub
Releases URLs, with no Releases API call. Firewalls must also permit GitHub's
release-download redirects.

## Zephyr: select the final link outputs

For each completed baseline/current build, select `build/zephyr/zephyr.map` together with `build/zephyr/zephyr.elf` from that same build. A custom build directory or sysbuild image changes the parent path; select the final pair within that image's `zephyr` directory.

`zephyr_pre0.*`, `zephyr_pre1.*` and other `zephyr_pre*` files are intermediate linker stages. Do not combine them with the final files, even when their timestamps are close. Do not combine files from different images or builds. FW Mem Guard never substitutes paths automatically. File names alone do not establish provenance: existing MAP/ELF structural checks still apply, and renamed intermediate files cannot be identified reliably by their names.

The next extension/CLI release adds an early, focused error for recognized intermediate filenames. In 0.3.7, a mixed pair may instead produce the general MAP/ELF mismatch diagnostic; reselect the final pair and rerun comparison.

[Verified firmware configurations and evidence](https://itainover-create.github.io/fw-mem-guard/REAL_FIRMWARE.html#zephyr).
