# Learnings

## [LRN-20261102-001] correction

**Logged**: 2026-11-02T00:06:38+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
Global cadence and per-monitor overrides are distinct persisted settings.

### Details
The user requires the top interval to govern page polling and the default server cadence. A monitor override must survive global changes, and clearing it must restore inheritance. A legacy explicit interval remains an override. Tests now exercise repeated edits, inheritance, and real scheduler timing.

### Suggested Action
Keep the backend catalog as the UI source of truth. Validate actual protocol responses and independent fixtures, rather than counting dropdown options alone.

### Metadata
- Source: user_feedback
- Related Files: lib/core.js, lib/checker.js, server.js, public/app.js, tests/scheduler.test.js
- Pattern-Key: harden.monitor_catalog_and_cadence
