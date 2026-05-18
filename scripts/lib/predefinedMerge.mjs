// Pure, importable merge function for the docs-MCP sync workflow.
//
// Given the existing text of a `.em.predefined` file and an array of incoming
// declarations from the docs catalogue, produce:
//   - the list of declarations whose identifier was NOT already present
//   - the list skipped (identifier already declared)
//   - the next file contents (with the new section appended)
//
// Rule: append-only. Existing declarations are never overwritten — the
// predefined file is the source of truth, the catalogue is a hint about what
// the docs currently say.
//
// Each new identifier is appended under a single dated section header so that
// readers can attribute imports to a specific sync run.

const SECTION_PREFIX = '// ─── Imported via npm run sync-docs';

/**
 * @typedef {Object} CatalogueSymbol
 * @property {string} module      one of "enma_stdlib" | "perception" (caller routes)
 * @property {string} name        identifier the file is keyed off
 * @property {"type"|"function"|"funcdef"|"global"} kind
 * @property {string} declaration verbatim text appended to the predefined
 * @property {string} [source]    optional URL recorded for traceability
 */

/**
 * @typedef {Object} MergeResult
 * @property {CatalogueSymbol[]} added    declarations that will be appended
 * @property {Array<{symbol: CatalogueSymbol, reason: string}>} skipped
 * @property {string} nextContent          full file text after append
 */

/**
 * @param {string} existingContent
 * @param {CatalogueSymbol[]} incoming
 * @param {string} [todayISODate] inject a date for deterministic tests
 * @returns {MergeResult}
 */
export function mergePredefined(existingContent, incoming, todayISODate) {
    const added = [];
    const skipped = [];

    for (const sym of incoming) {
        if (!sym || typeof sym.name !== 'string' || sym.name.length === 0) {
            skipped.push({ symbol: sym, reason: 'invalid symbol (no name)' });
            continue;
        }
        if (typeof sym.declaration !== 'string' || sym.declaration.length === 0) {
            skipped.push({ symbol: sym, reason: 'invalid symbol (no declaration)' });
            continue;
        }
        if (containsIdentifier(existingContent, sym.name)) {
            skipped.push({ symbol: sym, reason: 'already declared' });
            continue;
        }
        if (added.find(a => a.name === sym.name)) {
            // Duplicate within the incoming batch — keep the first, skip the rest.
            skipped.push({ symbol: sym, reason: 'duplicate within batch' });
            continue;
        }
        added.push(sym);
    }

    if (added.length === 0) {
        return { added, skipped, nextContent: existingContent };
    }

    const date = todayISODate ?? new Date().toISOString().slice(0, 10);
    const header = `\n\n${SECTION_PREFIX} ${date} ───\n`;
    const body = added.map(s => {
        const decl = s.declaration.trim();
        const trailer = s.source ? `\n// source: ${s.source}` : '';
        return `${trailer ? `${trailer}\n` : ''}${decl}`;
    }).join('\n\n');

    const trimmed = existingContent.replace(/\s*$/, '');
    return {
        added,
        skipped,
        nextContent: `${trimmed}${header}${body}\n`,
    };
}

/**
 * Heuristic identifier presence check. Matches:
 *   - declarations of the form `class Name`, `struct Name`, `interface Name`, `enum Name`
 *   - function-like declarations where Name appears at the head of a `Name(` pattern
 *   - global vars where Name appears as a standalone token followed by `;`
 *
 * Conservative on purpose: a false positive (skip-when-should-add) keeps the
 * predefined file stable; a false negative (re-add) is recoverable.
 * @param {string} content
 * @param {string} name
 * @returns {boolean}
 */
function containsIdentifier(content, name) {
    if (!name) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        new RegExp(`\\b(?:class|struct|interface|enum|namespace|typedef|funcdef)\\s+${escaped}\\b`),
        new RegExp(`\\b${escaped}\\s*\\(`),
        new RegExp(`\\b${escaped}\\s*;`),
    ];
    return patterns.some(re => re.test(content));
}
