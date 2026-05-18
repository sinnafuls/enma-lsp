// Multi-project workspace scope.
//
// A workspace can declare multiple Enma projects via `enma.projects[]`. Each
// project has a `sourceDirectory` (resolved against the workspace root) and an
// `lspMode` flag of either `full` or `syntaxOnly`:
//
//   full        — usual LSP behaviour: completion, hover, signature help, etc.
//   syntaxOnly  — tokenizer + parser diagnostics only; no analyzer; no
//                 IntelliSense. Useful for reference folders that shouldn't
//                 contribute symbols to the workspace.
//
// Files inside a `full` project get full LSP. Files inside a `syntaxOnly`
// project get only syntax diagnostics. Files outside every declared project
// also default to `full` so single-project workspaces (the common case)
// preserve today's behaviour.
//
// The mapping is computed once when settings change and looked up per-handler
// via `hasFullLsp(uri)`. URI prefix matching uses normalized lowercase paths
// so Windows drive-letter case differences don't cause misses.

export type LspMode = 'full' | 'syntaxOnly';

export interface ProjectConfig {
    /** Display name. */
    readonly name: string;
    /** Workspace-relative source directory (no trailing slash required). */
    readonly sourceDirectory: string;
    /** Workspace-relative bundler output path. */
    readonly outputFile?: string;
    /** Whether to strip comments when bundling. */
    readonly stripComments?: boolean;
    /** LSP scope for files under this project. Defaults to `full`. */
    readonly lspMode?: LspMode;
}

export interface ResolvedProject {
    readonly config: ProjectConfig;
    /** Absolute file:// URI of the source directory, always ends with `/`. */
    readonly sourceDirUri: string;
}

let s_resolved: ReadonlyArray<ResolvedProject> = [];

export function setResolvedProjects(resolved: ReadonlyArray<ResolvedProject>): void {
    s_resolved = resolved;
}

export function getResolvedProjects(): ReadonlyArray<ResolvedProject> {
    return s_resolved;
}

export function isMultiProjectMode(): boolean {
    return s_resolved.length > 0;
}

/** Find the project owning `uri`, or undefined if none match. */
export function getProjectForUri(uri: string): ResolvedProject | undefined {
    const needle = normalize(uri);
    for (const p of s_resolved) {
        if (needle.startsWith(normalize(p.sourceDirUri))) return p;
    }
    return undefined;
}

/**
 * Return true if `uri` should receive full LSP services.
 *
 * Rules:
 *   - No projects declared → always true (preserves single-project behaviour)
 *   - File inside a `full` project → true
 *   - File inside a `syntaxOnly` project → false
 *   - File outside every project → true (acts as a fall-through workspace)
 *   - `.em.predefined` files → always true; project boundaries don't apply to
 *     shared declaration files
 */
export function hasFullLsp(uri: string): boolean {
    if (s_resolved.length === 0) return true;
    if (uri.endsWith('.em.predefined') || uri.endsWith('em.predefined')) return true;
    const project = getProjectForUri(uri);
    if (project === undefined) return true;
    return (project.config.lspMode ?? 'full') === 'full';
}

/** Build a ResolvedProject set from raw config + workspace root URI. */
export function resolveProjects(
    projects: ReadonlyArray<ProjectConfig>,
    workspaceRootUri: string | undefined,
): ResolvedProject[] {
    const out: ResolvedProject[] = [];
    if (workspaceRootUri === undefined) return out;
    const rootNoSlash = workspaceRootUri.replace(/\/+$/, '');
    for (const p of projects) {
        if (!p.name || !p.sourceDirectory) continue;
        const dir = p.sourceDirectory.replace(/^[\\/]+/, '').replace(/[\\/]+$/, '');
        const uri = dir.length === 0 ? `${rootNoSlash}/` : `${rootNoSlash}/${dir.replace(/\\/g, '/')}/`;
        out.push({ config: p, sourceDirUri: uri });
    }
    return out;
}

function normalize(s: string): string {
    return s.replace(/\\/g, '/').toLowerCase();
}
