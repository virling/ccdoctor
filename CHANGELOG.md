# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Permissions check: reads this project's transcripts from the last 7 days and warns about folders outside the project that caused 5 or more `outsideReadsBlocked` approval prompts, unless they are already in `permissions.additionalDirectories`.

## [0.3.0] - 2026-11-27

### Added

- Claude Code plugin: `/plugin install ccdoctor@virling` runs the checks at every session start and warns only when something is broken.
- `ccdoctor hook`: the SessionStart hook mode behind the plugin.

## [0.2.0] - 2026-11-27

### Added

- MCP servers shipped by enabled plugins are checked and probed.
- Run from any folder inside a project: ccdoctor walks up to the project folder Claude Code keys its config by.

## [0.1.0] - 2026-11-27

### Added

- `ccdoctor` checks Claude Code settings files, hook commands and their scripts, MCP servers in every scope, and enabled plugins.
- `--probe` starts each stdio MCP server and lists its tools.
- Warns when an MCP server is registered but the hooks it ships are missing.
- `--json` output; exit code 1 when any check fails.

[Unreleased]: https://github.com/virling/ccdoctor/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/virling/ccdoctor/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/virling/ccdoctor/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/virling/ccdoctor/releases/tag/v0.1.0
