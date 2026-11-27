# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-27

### Added

- `ccdoctor` checks Claude Code settings files, hook commands and their scripts, MCP servers in every scope, and enabled plugins.
- `--probe` starts each stdio MCP server and lists its tools.
- Warns when an MCP server is registered but the hooks it ships are missing.
- `--json` output; exit code 1 when any check fails.

[Unreleased]: https://github.com/virling/ccdoctor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/virling/ccdoctor/releases/tag/v0.1.0
