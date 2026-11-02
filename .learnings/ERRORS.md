# Errors

## [ERR-20261102-001] xbrowser_windows

**Logged**: 2026-11-02T00:06:38+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
Browser commands can require explicit scrolling and careful Windows quoting.

### Error
The click command reported success before an offscreen submit button was actually activated. A native prompt also made the initiating click return an unknown error, although dialog acceptance completed the action.

### Resolution
Scroll the submit button into view, then click and verify the resulting application state. Handle native prompts with dialog accept and verify the saved value. Quote PowerShell @refs. Use forward slashes for screenshot paths inside batch commands. Clear resource timing entries before long-running polling observations to avoid the browser buffer limit.

### Metadata
- Related Files: exports/notes/reports/browser-verification.json
