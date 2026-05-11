// Strip the GitBook-exported Perception docs HTML for in-extension viewing.
//
// Input:  data/perception-docs.source.html  (saved-page HTML from GitBook)
// Output: client/resources/perception-docs.html  (clean, themable, no scripts)
//
// What this script removes:
//   - <head> entirely (replaced with a minimal CSP-clean head)
//   - all <script>, <link>, <style>, <noscript> tags
//   - everything before the first content page <div id="page-...">
//   - the "Untitled" cover h1 (GitBook puts this above the real content)
//   - external asset references that point to perceptioin_docs_files/* (the
//     asset folder isn't shipped — links would 404)
//
// What this script injects:
//   - a CSP <meta> that bans scripts (defence in depth — webview also sets CSP)
//   - one inline <style> that:
//       * resets the GitBook print-page container (no shadow, no max-width,
//         no white background, no min-height)
//       * provides fallback values for the GitBook --tint-*, --primary-*,
//         --neutral-* CSS variables using VSCode theme tokens
//       * styles headings, code blocks, and tables cleanly
//
// Run: node scripts/build-perception-docs.mjs

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const SRC = path.join(repoRoot, 'data', 'perception-docs.source.html');
const OUT_DIR = path.join(repoRoot, 'client', 'resources');
const OUT = path.join(OUT_DIR, 'perception-docs.html');

if (!fs.existsSync(SRC)) {
    console.error(`build-perception-docs: ERROR — ${SRC} not found`);
    process.exit(1);
}

const raw = fs.readFileSync(SRC, 'utf8');
const inputBytes = raw.length;

let html = raw;

// 1. Drop everything before the first content page.
//    Each chapter is wrapped in <div id="page-XXXX" class="my-11 ... bg-white ...">
//    The first one contains "Enma - Overview".
const firstPageIdx = html.search(/<div id="page-[A-Za-z0-9]+"[^>]*class="[^"]*max-w-4xl/);
if (firstPageIdx < 0) {
    console.error('build-perception-docs: ERROR — could not locate first content page');
    process.exit(1);
}
html = html.slice(firstPageIdx);

// 2. Drop everything after the last </div></body> chain. Find the closing body.
const bodyCloseIdx = html.lastIndexOf('</body>');
if (bodyCloseIdx > 0) {
    html = html.slice(0, bodyCloseIdx);
}

// 3. Strip all <script ...>...</script>, <link ...>, <style ...>...</style>,
//    <noscript>...</noscript>. Tolerate self-closing and missing close tags.
html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
html = html.replace(/<script\b[^>]*\/?>/gi, '');
html = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
html = html.replace(/<link\b[^>]*\/?>/gi, '');
html = html.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');

// 4. Strip references to the missing asset folder so the page never tries
//    to fetch perceptioin_docs_files/*.css|js|woff2|svg.
html = html.replace(/perceptioin_docs_files\/[^"' )]+/g, '');

// 5. Drop any <img>/<source>/<video>/<iframe> entirely — they reference
//    missing local assets.
html = html.replace(/<img\b[^>]*\/?>/gi, '');
html = html.replace(/<source\b[^>]*\/?>/gi, '');
html = html.replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, '');
html = html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
html = html.replace(/<iframe\b[^>]*\/?>/gi, '');

// 5b. Drop all inline <svg>...</svg> elements. GitBook embeds 133 of these as
//     external-link icons, chapter-jump arrows, and copy-code chrome. Without
//     their original sizing CSS they render at huge default dimensions — see
//     screenshot regression that triggered this fix.
html = html.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '');

// 5c. Drop GitBook's chrome buttons (copy-code, jump-to-section, theme toggle).
//     They're useless without their scripts and they steal click events.
html = html.replace(/<button\b[^>]*>[\s\S]*?<\/button>/gi, '');

// 5d. Rewrite GitBook self-links so they navigate inside the webview instead
//     of opening the external gitbook.com URL. The TOC and inline cross-refs
//     produce hrefs like
//        https://open-2v.gitbook.com/~space/.../~gitbook/pdf?limit=100&back=false#page-XXX
//     Each section's wrapper has id="page-XXX", so the fragment alone is enough
//     for in-page navigation. Keep the leading-hash form.
html = html.replace(
    /href="https?:\/\/[^"]*?#(page-[A-Za-z0-9]+)"/g,
    'href="#$1"',
);
// Drop any remaining absolute hrefs to gitbook (no fragment) — they'd 404 in
// the webview since enableScripts is false and we can't bounce them out.
html = html.replace(
    /href="https?:\/\/(?:open-2v\.gitbook\.com|app\.gitbook\.com)\/[^"]*"/g,
    'href="#"',
);

// External links to the Enma language docs (or any non-gitbook-export domain)
// should open in the user's system browser, not navigate the webview. Mark
// them target="_blank" so VSCode's webview link handler routes them out.
html = html.replace(
    /<a\s+([^>]*?)href="(https?:\/\/[^"]+)"([^>]*)>/g,
    '<a $1href="$2"$3 target="_blank" rel="noopener noreferrer">',
);

// Unwrap clicker-bait <a href="#"> shells (gitbook chapter-nav / theme chrome
// stubs) — turn them into plain spans so they're not styled as links and don't
// jump to top when clicked.
html = html.replace(
    /<a\b[^>]*href="#"[^>]*>([\s\S]*?)<\/a>/g,
    '<span>$1</span>',
);

// 6. Strip HTML comments (often <!-- --> placeholders left by the framework).
html = html.replace(/<!--[\s\S]*?-->/g, '');

// 6a. Strip empty container chains left over from SVG / asset stripping.
//     GitBook wraps each <h2>/<h3> hash-anchor link in <div class="..."><span></span></div>;
//     once the SVG icon inside is gone these wrappers are dead weight and
//     produce an empty line above every subheading. Iterate to a fixed point
//     because stripping inner empties exposes newly-empty outer containers.
let _prevHtml;
do {
    _prevHtml = html;
    html = html
        .replace(/<span\b[^>]*>\s*<\/span>/g, '')
        .replace(/<a\b[^>]*>\s*<\/a>/g, '')
        .replace(/<div\b[^>]*>\s*<\/div>/g, '')
        .replace(/<p\b[^>]*>\s*<\/p>/g, '');
} while (_prevHtml !== html);

// 6b. Re-highlight code blocks using Enma's keyword set.
//
// The source HTML's shiki spans reference GitBook CSS vars that don't ship
// (--tint-11, --tint-12), so every token rendered as inherited foreground —
// effectively unstyled monospace. We replace each <pre><code> body with a
// freshly tokenised representation using Enma's reserved word list.
//
// CSS for the .hl-* classes is added below in the injected stylesheet.

// Canonical Enma keyword / primitive sets — kept in lockstep with
// server/src/compiler_tokenizer/reservedWord.ts. Don't add to this list
// without also adding upstream; the highlighter is a derived view.
const ENMA_PRIMITIVES = new Set([
    'int8', 'int16', 'int32', 'int64',
    'uint8', 'uint16', 'uint32', 'uint64',
    'aint8', 'aint16', 'aint32', 'aint64',
    'float32', 'float', 'float64', 'double',
    'char', 'wchar', 'bool', 'string', 'wstring', 'void', 'size_t',
    'auto', 'nullable',
    // common Enma stdlib container types — colour as types in docs
    'array', 'map', 'imap', 'list', 'hash_set', 'sorted_map',
    'vec2', 'vec3', 'vec4', 'quat', 'mat4', 'variant',
    'mutex', 'lock_guard', 'cond_var', 'atomic_int32', 'atomic_int64',
    'file_t', 'regex', 'json_value', 'coroutine_t',
    // Perception API types
    'proc_t', 'vad_region_t', 'cpu_t', 'frame_t', 'layer_t', 'widget_t',
    'button_t', 'checkbox_t', 'label_t', 'slider_t', 'menu_t',
    'sidebar_section_t', 'file_picker_t', 'zydis_req_t', 'zydis_builder_t',
    'color',
]);
const ENMA_KEYWORDS = new Set([
    'if', 'else', 'for', 'while', 'do', 'switch', 'match', 'case', 'default',
    'break', 'continue', 'return', 'goto', 'try', 'catch', 'throw', 'defer', 'yield',
    'class', 'struct', 'interface', 'enum', 'namespace', 'using', 'template',
    'typedef', 'decltype', 'typename', 'mixin', 'import', 'extern', 'delegate',
    'property', 'operator', 'coroutine',
    'static', 'const', 'constexpr', 'override', 'public', 'private',
    'out', 'inline', 'volatile', 'get', 'set', 'final', 'virtual', 'friend',
    'true', 'false', 'null', 'nullptr', 'this',
    'new', 'delete', 'sizeof', 'offsetof', 'static_assert', 'cast',
    'static_cast', 'reinterpret_cast', 'const_cast',
]);

/** Decode a small set of HTML entities found in our code blocks. */
function decodeEntities(s) {
    return s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
}

/** Escape plain text for safe HTML embedding. */
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Tokenise Enma source into highlight spans. Tolerant — anything we don't
 * recognise gets emitted as plain (unwrapped) text.
 */
function highlightEnma(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];

        // Line comment.
        if (c === '/' && src[i + 1] === '/') {
            let j = i;
            while (j < n && src[j] !== '\n') j++;
            out += `<span class="hl-com">${escapeHtml(src.slice(i, j))}</span>`;
            i = j;
            continue;
        }
        // Block comment.
        if (c === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            const j = end < 0 ? n : end + 2;
            out += `<span class="hl-com">${escapeHtml(src.slice(i, j))}</span>`;
            i = j;
            continue;
        }
        // String / f-string.
        if (c === '"' || (c === 'f' && src[i + 1] === '"')) {
            const start = c === 'f' ? i + 1 : i;
            let j = start + 1;
            while (j < n) {
                if (src[j] === '\\' && j + 1 < n) { j += 2; continue; }
                if (src[j] === '"') { j++; break; }
                if (src[j] === '\n') break;
                j++;
            }
            out += `<span class="hl-str">${escapeHtml(src.slice(i, j))}</span>`;
            i = j;
            continue;
        }
        // Char literal.
        if (c === "'") {
            let j = i + 1;
            while (j < n && src[j] !== "'" && src[j] !== '\n') {
                if (src[j] === '\\' && j + 1 < n) j++;
                j++;
            }
            if (j < n && src[j] === "'") j++;
            out += `<span class="hl-str">${escapeHtml(src.slice(i, j))}</span>`;
            i = j;
            continue;
        }
        // Annotation [[...]].
        if (c === '[' && src[i + 1] === '[') {
            const end = src.indexOf(']]', i + 2);
            if (end >= 0) {
                const j = end + 2;
                out += `<span class="hl-ann">${escapeHtml(src.slice(i, j))}</span>`;
                i = j;
                continue;
            }
        }
        // Number (decimal / hex / binary), with optional separators / dot / exponent / suffix.
        if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
            let j = i;
            // 0x / 0b prefix
            if (src[j] === '0' && (src[j + 1] === 'x' || src[j + 1] === 'X' || src[j + 1] === 'b' || src[j + 1] === 'B')) {
                j += 2;
                while (j < n && /[0-9a-fA-F_]/.test(src[j])) j++;
            } else {
                while (j < n && /[0-9_]/.test(src[j])) j++;
                if (src[j] === '.') {
                    j++;
                    while (j < n && /[0-9_]/.test(src[j])) j++;
                }
                if (src[j] === 'e' || src[j] === 'E') {
                    j++;
                    if (src[j] === '+' || src[j] === '-') j++;
                    while (j < n && /[0-9_]/.test(src[j])) j++;
                }
            }
            // suffix (f, u, etc.)
            while (j < n && /[fFuUlL]/.test(src[j])) j++;
            out += `<span class="hl-num">${escapeHtml(src.slice(i, j))}</span>`;
            i = j;
            continue;
        }
        // Identifier / keyword.
        if (/[A-Za-z_]/.test(c)) {
            let j = i + 1;
            while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
            const word = src.slice(i, j);
            // Look ahead for '(' (function call) — skip whitespace.
            let k = j;
            while (k < n && (src[k] === ' ' || src[k] === '\t')) k++;
            const isCall = src[k] === '(';

            let cls = null;
            if (ENMA_PRIMITIVES.has(word)) cls = 'hl-ty';
            else if (ENMA_KEYWORDS.has(word)) cls = 'hl-kw';
            else if (isCall) cls = 'hl-fn';

            out += cls
                ? `<span class="${cls}">${escapeHtml(word)}</span>`
                : escapeHtml(word);
            i = j;
            continue;
        }
        // Default: punctuation / whitespace — emit one char as escaped.
        out += escapeHtml(c);
        i++;
    }
    return out;
}

/**
 * Replace each <pre>...<code>...</code></pre> body with re-highlighted markup.
 * Extracts the plain text by stripping all inner tags, then tokenises.
 */
html = html.replace(
    /(<pre\b[^>]*>\s*<code\b[^>]*>)([\s\S]*?)(<\/code>\s*<\/pre>)/g,
    (_match, open, body, close) => {
        // Strip all tags, then decode entities.
        const plain = decodeEntities(body.replace(/<[^>]+>/g, ''));
        // Drop the GitBook "table" class on <code> so display:block CSS applies cleanly.
        const cleanOpen = open.replace(/<code\b[^>]*>/, '<code>');
        return `${cleanOpen}${highlightEnma(plain)}${close}`;
    },
);

// 7. Strip event-handler attributes (onclick=, onload=, etc.) defensively.
html = html.replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '');
html = html.replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '');

// 8. Strip the "Untitled" cover h1 if it leaked into our slice.
html = html.replace(/<h1[^>]*>Untitled<\/h1>/g, '');

// 9. Compose final document. Inject themable CSS and a script-banning CSP.
const css = `
:root {
    color-scheme: light dark;

    /* VSCode theme tokens with sane fallbacks. */
    --fg:       var(--vscode-foreground, #cccccc);
    --fg-muted: var(--vscode-descriptionForeground, #9d9d9d);
    --bg:       var(--vscode-editor-background, #1e1e1e);
    --bg-alt:   var(--vscode-sideBar-background, #252526);
    --code-bg:  var(--vscode-textCodeBlock-background, #1f1f1f);
    --code-fg:  var(--vscode-textPreformat-foreground, #d7ba7d);
    --border:   var(--vscode-panel-border, #3c3c3c);
    --link:     var(--vscode-textLink-foreground, #3794ff);

    /* Fallbacks for GitBook's --tint-* / --primary-* / --neutral-* tokens
       (their original light-mode values are baked into element style="...").
       Map them to VSCode theme tokens so colours don't look out of place. */
    --tint-1: var(--vscode-editor-background);
    --tint-2: var(--vscode-editor-background);
    --tint-3: var(--vscode-sideBar-background);
    --tint-4: var(--vscode-input-background);
    --tint-11: var(--vscode-foreground);
    --tint-12: var(--vscode-foreground);
    --primary-1: var(--vscode-editor-background);
    --primary-9: var(--vscode-textLink-foreground);
    --primary-11: var(--vscode-textLink-foreground);
    --neutral-3: var(--vscode-sideBar-background);
    --neutral-9: var(--vscode-descriptionForeground);
    --neutral-11: var(--vscode-foreground);
    --neutral-12: var(--vscode-foreground);
}

html, body {
    margin: 0;
    padding: 0;
    background: var(--bg);
    color: var(--fg);
    font: 14px/1.55 var(--vscode-font-family, -apple-system, "Segoe UI", Tahoma, sans-serif);
}

/* Override the GitBook print-page container — strip the simulated paper. */
[id^="page-"] {
    max-width: 980px !important;
    margin: 0 auto !important;
    padding: 1.5rem 2rem !important;
    background: transparent !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    min-height: 0 !important;
    break-before: auto !important;
    break-after: auto !important;
}

/* Add a soft divider between sections. */
[id^="page-"] + [id^="page-"] {
    border-top: 1px solid var(--border) !important;
    margin-top: 2rem !important;
}

/* Headings. */
h1 { font-size: 1.85rem; margin: 1.6rem 0 0.9rem; font-weight: 600; color: var(--fg); }
h2 { font-size: 1.35rem; margin: 1.4rem 0 0.7rem; font-weight: 600; color: var(--fg); }
h3 { font-size: 1.1rem;  margin: 1.1rem 0 0.5rem; font-weight: 600; color: var(--fg); }
h4 { font-size: 1.0rem;  margin: 0.9rem 0 0.4rem; font-weight: 600; color: var(--fg-muted); }

/* Tailwind size escape hatches occasionally collide; force our scale. */
.text-6xl, .text-5xl, .text-4xl { font-size: 1.85rem !important; }
.text-3xl { font-size: 1.35rem !important; }
.text-2xl { font-size: 1.1rem !important; }

p { margin: 0.6rem 0; }
ul, ol { margin: 0.6rem 0; padding-left: 1.4rem; }
li { margin: 0.2rem 0; }
hr { border: 0; border-top: 1px solid var(--border); margin: 1.2rem 0; }

a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }

/* Inline code. */
code {
    font: 0.92em var(--vscode-editor-font-family, "Cascadia Code", Consolas, monospace);
    background: var(--code-bg);
    color: var(--code-fg);
    padding: 0.05rem 0.32rem;
    border-radius: 3px;
    border: 1px solid var(--border);
}

/* Code blocks: GitBook uses <pre> wrapping shiki <span class="highlight-line">.
   The default <pre> already preserves whitespace; we just theme it and ensure
   children break onto their own lines. */
pre {
    background: var(--code-bg);
    color: var(--code-fg);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.8rem 1rem;
    margin: 0.8rem 0;
    overflow-x: auto;
    font: 0.92em/1.5 var(--vscode-editor-font-family, "Cascadia Code", Consolas, monospace);
    white-space: pre;
}
pre code {
    background: transparent;
    border: 0;
    padding: 0;
    color: inherit;
    font-size: inherit;
    display: block;       /* GitBook code wrapper is class="table" — force block */
    white-space: pre;
}
span.highlight-line {
    display: block;
    white-space: pre;
}
span.highlight-line-content { white-space: pre; }
/* Override per-token light-mode colours from inline style attributes —
   shiki inlines style="color: light-dark(rgb(var(--tint-11)), ...)" on every
   span, which falls back to unset without GitBook's variable definitions.
   Our own .hl-* spans take precedence via higher specificity below. */
pre span[style],
span.highlight-line span,
span.highlight-line-content span {
    color: inherit !important;
}

/* Build-time Enma syntax colouring. Uses VSCode symbol-icon foreground
   tokens (which webviews DO expose) with Dark+ defaults as fallbacks. */
pre code .hl-kw  { color: var(--vscode-symbolIcon-keywordForeground,  #C586C0); }
pre code .hl-ty  { color: var(--vscode-symbolIcon-classForeground,    #4EC9B0); }
pre code .hl-fn  { color: var(--vscode-symbolIcon-functionForeground, #DCDCAA); }
pre code .hl-str { color: var(--vscode-symbolIcon-stringForeground,   #CE9178); }
pre code .hl-num { color: var(--vscode-symbolIcon-numberForeground,   #B5CEA8); }
pre code .hl-com { color: var(--vscode-symbolIcon-textForeground,     #6A9955); font-style: italic; }
pre code .hl-ann { color: var(--vscode-symbolIcon-variableForeground, #9CDCFE); }
/* Specificity bump: the generic "pre span[style] { color: inherit !important }"
   above would otherwise win against our class rules. .hl-* spans have no inline
   style attribute, so we just need any rule to land — but we use !important
   defensively in case some fragment slips through with a style attr. */
pre code span.hl-kw,
pre code span.hl-ty,
pre code span.hl-fn,
pre code span.hl-str,
pre code span.hl-num,
pre code span.hl-com,
pre code span.hl-ann { color: inherit; }
pre code span.hl-kw  { color: var(--vscode-symbolIcon-keywordForeground,  #C586C0) !important; }
pre code span.hl-ty  { color: var(--vscode-symbolIcon-classForeground,    #4EC9B0) !important; }
pre code span.hl-fn  { color: var(--vscode-symbolIcon-functionForeground, #DCDCAA) !important; }
pre code span.hl-str { color: var(--vscode-symbolIcon-stringForeground,   #CE9178) !important; }
pre code span.hl-num { color: var(--vscode-symbolIcon-numberForeground,   #B5CEA8) !important; }
pre code span.hl-com { color: #6A9955 !important; font-style: italic; }
pre code span.hl-ann { color: var(--vscode-symbolIcon-variableForeground, #9CDCFE) !important; }

/* Tables (used for parameter/return-value lists in some sections). */
table {
    border-collapse: collapse;
    margin: 0.8rem 0;
    width: 100%;
    font-size: 0.95em;
}
th, td {
    border: 1px solid var(--border);
    padding: 0.4rem 0.65rem;
    text-align: left;
    vertical-align: top;
}
th { background: var(--bg-alt); font-weight: 600; }

/* Quote / callout boxes. */
blockquote {
    border-left: 3px solid var(--link);
    background: var(--bg-alt);
    margin: 0.8rem 0;
    padding: 0.5rem 0.9rem;
    color: var(--fg-muted);
}

/* Selection colour matches editor. */
::selection { background: var(--vscode-editor-selectionBackground, rgba(38, 79, 120, 0.6)); }
`.trim();

const finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
<title>Perception API — Enma</title>
<style>
${css}
</style>
</head>
<body>
${html.trim()}
</body>
</html>
`;

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, finalHtml, 'utf8');

const outBytes = finalHtml.length;
console.log(`build-perception-docs: wrote ${OUT}`);
console.log(`  input:    ${inputBytes.toLocaleString()} bytes`);
console.log(`  output:   ${outBytes.toLocaleString()} bytes  (${((1 - outBytes / inputBytes) * 100).toFixed(1)}% smaller)`);
