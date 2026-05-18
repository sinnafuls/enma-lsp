// Pure data + scan helpers powering the auto-import code action. Kept in a
// separate module so mocha can exercise the scan logic without dragging in the
// `vscode` API surface (which is only resolvable inside the extension host).
//
// Catalogue policy: a name appears in exactly one module. Adding here is the
// only place a future contributor needs to touch — extension.ts wires the
// provider once.

/** Module → identifiers that, when used unimported, should trigger a fix. */
export const AUTO_IMPORT_MODULES: ReadonlyMap<string, ReadonlyArray<string>> = new Map([
    ['vec', [
        'vec2', 'vec3', 'vec4',
        'dot', 'cross', 'normalize', 'length_of',
        'deg_to_rad', 'rad_to_deg',
        'ease_in', 'ease_out', 'ease_in_out',
        'lerp_angle',
    ]],
    ['color', [
        'color',
        'color_lerp', 'color_hsv', 'color_from_hex',
    ]],
    ['math3d', [
        'mat4', 'quat',
        'mat4_identity', 'mat4_translate', 'mat4_rotate', 'mat4_scale',
        'mat4_perspective', 'mat4_lookat',
        'quat_from_euler', 'quat_slerp',
    ]],
    ['regex', [
        'regex',
    ]],
    ['json', [
        'json_value', 'json_parse', 'json_stringify',
    ]],
    ['time', [
        'now_ms', 'now_ns', 'sleep_ms',
    ]],
    ['thread', [
        'thread', 'mutex', 'cond_var', 'lock_guard',
    ]],
    ['atomic', [
        'atomic_int32', 'atomic_int64',
    ]],
    ['file', [
        'file_t', 'file_open', 'file_read', 'file_write',
    ]],
]);

/**
 * Lookup an identifier to the module that defines it. Returns undefined if the
 * identifier is not in the auto-import catalogue.
 */
export function moduleForIdentifier(name: string): string | undefined {
    for (const [mod, names] of AUTO_IMPORT_MODULES) {
        if (names.includes(name)) return mod;
    }
    return undefined;
}

/** Strip line/block comments and double-quoted strings from a source buffer.
 *  Leaves whitespace newlines intact so line numbers are preserved when callers
 *  use the result for further line-based scanning. */
export function stripCommentsAndStrings(src: string): string {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        const next = src[i + 1] ?? '';

        // Block comment.
        if (c === '/' && next === '*') {
            const end = src.indexOf('*/', i + 2);
            const stop = end < 0 ? n : end + 2;
            for (let j = i; j < stop; j++) out += src[j] === '\n' ? '\n' : ' ';
            i = stop;
            continue;
        }
        // Line comment.
        if (c === '/' && next === '/') {
            while (i < n && src[i] !== '\n') { out += ' '; i++; }
            continue;
        }
        // Triple-quoted heredoc.
        if (c === '"' && next === '"' && src[i + 2] === '"') {
            const end = src.indexOf('"""', i + 3);
            const stop = end < 0 ? n : end + 3;
            for (let j = i; j < stop; j++) out += src[j] === '\n' ? '\n' : ' ';
            i = stop;
            continue;
        }
        // Double-quoted string (with escapes).
        if (c === '"') {
            out += ' ';
            i++;
            while (i < n) {
                if (src[i] === '\\' && i + 1 < n) {
                    out += src[i] === '\n' ? '\n' : ' ';
                    out += src[i + 1] === '\n' ? '\n' : ' ';
                    i += 2;
                    continue;
                }
                if (src[i] === '"') { out += ' '; i++; break; }
                out += src[i] === '\n' ? '\n' : ' ';
                i++;
            }
            continue;
        }
        // Single-quoted char literal.
        if (c === "'") {
            out += ' ';
            i++;
            while (i < n) {
                if (src[i] === '\\' && i + 1 < n) {
                    out += '  ';
                    i += 2;
                    continue;
                }
                if (src[i] === "'") { out += ' '; i++; break; }
                out += src[i] === '\n' ? '\n' : ' ';
                i++;
            }
            continue;
        }

        out += c;
        i++;
    }
    return out;
}

/** Return the set of modules already imported via `import "<module>";`. */
export function parseImportedModules(src: string): Set<string> {
    const out = new Set<string>();
    // Only scan stripped source so an `import "vec";` *inside a comment* doesn't
    // count as a real import.
    const clean = stripCommentsAndStrings(src);
    // The stripper blanks string bodies, so we re-match against the original to
    // capture the module path. Anchor on `import \s+ "..."` at start-of-line.
    const re = /(^|\n)\s*import\s+"([^"\n]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
        const start = m.index + (m[1].length === 0 ? 0 : 1);
        if (clean[start] !== 'i') continue;
        // Module path may carry a sub-path or extension; treat the leaf as the
        // module name for catalogue lookup.
        const path = m[2];
        const leaf = path.replace(/\.em$/, '').split('/').pop();
        if (leaf) out.add(leaf);
        out.add(path);
    }
    return out;
}

export interface MissingImport {
    /** Module the identifier resolves to. */
    module: string;
    /** Identifier text. */
    name: string;
    /** Line in the source where the identifier appears (0-based). */
    line: number;
    /** Column where the identifier starts (0-based). */
    character: number;
}

const IDENT = /[A-Za-z_][A-Za-z0-9_]*/g;

/** Walk the source and find catalogue-known identifiers whose module isn't
 *  already imported. Returns one entry per first hit per (module,name) pair. */
export function findMissingImports(src: string): MissingImport[] {
    const imported = parseImportedModules(src);
    const clean = stripCommentsAndStrings(src);
    const lines = clean.split('\n');

    const out: MissingImport[] = [];
    const seen = new Set<string>();
    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
        const line = lines[lineNo];
        IDENT.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = IDENT.exec(line)) !== null) {
            const name = m[0];
            const mod = moduleForIdentifier(name);
            if (mod === undefined) continue;
            if (imported.has(mod)) continue;
            const key = `${mod}:${name}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ module: mod, name, line: lineNo, character: m.index });
        }
    }
    return out;
}

// Line index (0-based) where the next non-preamble line begins. The preamble
// is the prefix of consecutive blank lines, line comments, block comments,
// `#include` directives, and `import "…";` statements at top-of-file. New
// imports get inserted at the returned line index.
export function preambleEndLine(src: string): number {
    const clean = stripCommentsAndStrings(src);
    const lines = clean.split('\n');
    let i = 0;
    while (i < lines.length) {
        const ln = lines[i].trim();
        if (ln.length === 0) { i++; continue; }
        // After stripping, only directive-shaped tokens remain.
        const raw = src.split('\n')[i].trim();
        if (raw.startsWith('#include')) { i++; continue; }
        if (raw.startsWith('import ')) { i++; continue; }
        break;
    }
    return i;
}
