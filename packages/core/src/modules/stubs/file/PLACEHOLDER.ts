/**
 * Local file read/write connector.
 *
 * Planned capabilities:
 *   - file.read.text      — TXT, Markdown
 *   - file.read.docx
 *   - file.read.pdf       — PDF text extract (priority)
 *   - file.write
 *   - file.watch          — folder watch trigger (later)
 *
 * sideEffect: NONE (read), REVERSIBLE (write)
 *
 * Register: capabilities.ts, catalog.ts, registry.ts, mocks/
 *
 * @see ../../nodes/README.md
 */
export {};
