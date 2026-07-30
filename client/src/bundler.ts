// VSCode commands + task provider for the Enma bundler.
//
// Mirrors angel-lsp's bundler UX:
//   enma.bundle           — bundle the configured source/output pair
//   enma.bundleStripped   — same with comments stripped
//   enma.bundleProject    — pick from `enma.projects` and bundle one
//   enma.bundleAll        — bundle every entry in `enma.projects`
//   enma.initProject      — scaffold .vscode/tasks.json + source/main.em
//
// The bundler script itself lives at `<extension>/scripts/bundler.mjs` and is
// invoked via `child_process.fork()` so that errors surface verbatim in the
// "Enma Bundler" output channel.

import * as path from 'path';
import * as fs from 'fs';
import { fork } from 'child_process';
import {
    commands,
    workspace,
    window,
    tasks,
    Task,
    TaskProvider,
    TaskDefinition,
    TaskScope,
    ShellExecution,
    ExtensionContext,
    OutputChannel,
    Uri,
} from 'vscode';

// --------------------------------------------------------------------------
// Source map — maps bundled line numbers back to original source files
// --------------------------------------------------------------------------

export interface SourceMapEntry {
    bundledLine: number;
    originalUri: string;
    originalLine: number;
}

export interface BundleResult {
    output: string;
    manifest: string[];
    warnings: string[];
    errors: string[];
    sourceMap?: SourceMapEntry[];
}

/**
 * Binary-search `sourceMap` (sorted ascending by bundledLine) for the original
 * source location that corresponds to `bundledLine`.
 *
 * Returns `undefined` when `bundledLine` falls before the first mapped entry
 * (e.g. inside the header comment block).
 */
export function mapBundledLineTo(
    sourceMap: SourceMapEntry[],
    bundledLine: number,
): { uri: string; line: number } | undefined {
    if (sourceMap.length === 0) return undefined;
    let lo = 0;
    let hi = sourceMap.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >>> 1;
        if (sourceMap[mid].bundledLine <= bundledLine) lo = mid;
        else hi = mid - 1;
    }
    const entry = sourceMap[lo];
    if (entry.bundledLine > bundledLine) return undefined;
    return { uri: entry.originalUri, line: bundledLine - entry.bundledLine + entry.originalLine };
}

interface ProjectConfig {
    name: string;
    sourceDirectory: string;
    outputFile: string;
    stripComments?: boolean;
}

interface BundleTaskDefinition extends TaskDefinition {
    type: 'enma-bundle';
    src: string;
    out: string;
    strip?: boolean;
}

let outputChannel: OutputChannel | undefined;

function getOutput(): OutputChannel {
    if (!outputChannel) outputChannel = window.createOutputChannel('Enma Bundler');
    return outputChannel;
}

function workspaceRootFsPath(): string | undefined {
    const folders = workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    return folders[0].uri.fsPath;
}

function resolveAgainstRoot(p: string): string | undefined {
    if (path.isAbsolute(p)) return p;
    const root = workspaceRootFsPath();
    if (!root) return undefined;
    return path.resolve(root, p);
}

function bundlerScriptPath(context: ExtensionContext): string {
    return context.asAbsolutePath(path.join('scripts', 'bundler.mjs'));
}

async function runBundler(
    context: ExtensionContext,
    src: string,
    out: string,
    strip: boolean,
): Promise<void> {
    const oc = getOutput();
    oc.show(true);
    const script = bundlerScriptPath(context);
    const args = [src, out];
    if (strip) args.push('--strip');
    oc.appendLine(`[bundler] node ${script} ${args.join(' ')}`);

    return new Promise<void>((resolve, reject) => {
        const child = fork(script, args, {
            cwd: workspaceRootFsPath() ?? path.dirname(src),
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            silent: true,
        });
        child.stdout?.on('data', (d) => oc.append(d.toString()));
        child.stderr?.on('data', (d) => oc.append(d.toString()));
        child.on('exit', (code) => {
            oc.appendLine(`[bundler] exit ${code}`);
            if (code === 0) resolve();
            else reject(new Error(`bundler exited with code ${code}`));
        });
        child.on('error', reject);
    });
}

function readProjects(): ProjectConfig[] {
    const cfg = workspace.getConfiguration('enma');
    const list = cfg.get<ProjectConfig[]>('projects', []);
    return Array.isArray(list) ? list : [];
}

function readBundlerSettings(): { src: string; out: string; strip: boolean } {
    const cfg = workspace.getConfiguration('enma.bundler');
    return {
        src: cfg.get<string>('sourceDirectory', 'source'),
        out: cfg.get<string>('outputFile', 'output/bundled.em'),
        strip: cfg.get<boolean>('stripComments', true),
    };
}

function readBundleOnSave(): boolean {
    const cfg = workspace.getConfiguration('enma.bundler');
    return cfg.get<boolean>('bundleOnSave', false);
}

// Debounce window for bundleOnSave. Long enough that a rapid burst of
// `Ctrl+S` saves across multiple files (e.g. format-on-save in batches) only
// triggers a single bundler run.
const BUNDLE_ON_SAVE_DEBOUNCE_MS = 750;

// --------------------------------------------------------------------------
// Commands
// --------------------------------------------------------------------------

async function cmdBundle(context: ExtensionContext, forceStrip?: boolean): Promise<void> {
    const settings = readBundlerSettings();
    const src = resolveAgainstRoot(settings.src);
    const out = resolveAgainstRoot(settings.out);
    if (!src || !out) {
        window.showErrorMessage('Enma: open a workspace folder first.');
        return;
    }
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
        const pick = await window.showWarningMessage(
            `Enma: source directory not found at ${src}. Pick a different directory?`,
            'Pick directory', 'Cancel',
        );
        if (pick !== 'Pick directory') return;
        const chosen = await window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
        });
        if (!chosen || chosen.length === 0) return;
        await runBundler(context, chosen[0].fsPath, out, forceStrip ?? settings.strip);
        return;
    }
    await runBundler(context, src, out, forceStrip ?? settings.strip);
}

async function cmdBundleProject(context: ExtensionContext): Promise<void> {
    const projects = readProjects();
    if (projects.length === 0) {
        window.showInformationMessage(
            'Enma: no projects configured. Add `enma.projects` to your settings.',
        );
        return;
    }
    const pick = await window.showQuickPick(
        projects.map(p => ({
            label: p.name,
            description: `${p.sourceDirectory} → ${p.outputFile}`,
            project: p,
        })),
        { placeHolder: 'Pick an Enma project to bundle' },
    );
    if (!pick) return;
    const src = resolveAgainstRoot(pick.project.sourceDirectory);
    const out = resolveAgainstRoot(pick.project.outputFile);
    if (!src || !out) return;
    await runBundler(context, src, out, !!pick.project.stripComments);
}

async function cmdBundleAll(context: ExtensionContext): Promise<void> {
    const projects = readProjects();
    if (projects.length === 0) {
        window.showInformationMessage(
            'Enma: no projects configured. Add `enma.projects` to your settings.',
        );
        return;
    }
    for (const p of projects) {
        const src = resolveAgainstRoot(p.sourceDirectory);
        const out = resolveAgainstRoot(p.outputFile);
        if (!src || !out) continue;
        try {
            await runBundler(context, src, out, !!p.stripComments);
        } catch (e) {
            getOutput().appendLine(`[bundler] project '${p.name}' failed: ${(e as Error).message}`);
        }
    }
}

async function cmdInitProject(): Promise<void> {
    const root = workspaceRootFsPath();
    if (!root) {
        window.showErrorMessage('Enma: open a workspace folder first.');
        return;
    }
    const sourceDir = path.join(root, 'source');
    const vscodeDir = path.join(root, '.vscode');
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(vscodeDir, { recursive: true });

    const mainPath = path.join(sourceDir, 'main.em');
    if (!fs.existsSync(mainPath)) {
        fs.writeFileSync(
            mainPath,
            [
                '// Perception Enma entry — https://docs.perception.cx/perception/lifecycle-and-routines.md',
                'int64 main()',
                '{',
                '    // return > 0 to stay loaded; <= 0 unloads after main',
                '    return 1;',
                '}',
                '',
            ].join('\n'),
            'utf8',
        );
    }
    const tasksPath = path.join(vscodeDir, 'tasks.json');
    if (!fs.existsSync(tasksPath)) {
        const tasksJson = {
            version: '2.0.0',
            tasks: [
                {
                    label: 'Enma: bundle',
                    type: 'enma-bundle',
                    src: 'source',
                    out: 'output/bundled.em',
                    strip: false,
                    problemMatcher: [],
                },
            ],
        };
        fs.writeFileSync(tasksPath, JSON.stringify(tasksJson, null, 4) + '\n', 'utf8');
    }
    window.showInformationMessage('Enma: project scaffolded (source/main.em + .vscode/tasks.json).');
    const doc = await workspace.openTextDocument(Uri.file(mainPath));
    await window.showTextDocument(doc);
}

// --------------------------------------------------------------------------
// Task provider
// --------------------------------------------------------------------------

class EnmaBundleTaskProvider implements TaskProvider {
    constructor(private readonly context: ExtensionContext) {}

    provideTasks(): Task[] {
        return [];
    }

    resolveTask(task: Task): Task | undefined {
        const def = task.definition as BundleTaskDefinition;
        if (def.type !== 'enma-bundle') return undefined;
        const src = resolveAgainstRoot(def.src) ?? def.src;
        const out = resolveAgainstRoot(def.out) ?? def.out;
        const script = bundlerScriptPath(this.context);
        const args = [`"${src}"`, `"${out}"`];
        if (def.strip) args.push('--strip');
        const exec = new ShellExecution(`node "${script}" ${args.join(' ')}`);
        return new Task(
            def,
            task.scope ?? TaskScope.Workspace,
            task.name ?? `bundle ${path.basename(src)}`,
            'enma',
            exec,
        );
    }
}

// --------------------------------------------------------------------------
// Activation entry
// --------------------------------------------------------------------------

async function bundleDefaultTarget(context: ExtensionContext): Promise<void> {
    const projects = readProjects();
    if (projects.length > 0) {
        const p = projects[0];
        const src = resolveAgainstRoot(p.sourceDirectory);
        const out = resolveAgainstRoot(p.outputFile);
        if (!src || !out) return;
        await runBundler(context, src, out, !!p.stripComments);
        return;
    }
    await cmdBundle(context);
}

let s_bundleDebounce: NodeJS.Timeout | undefined;

function scheduleBundleOnSave(context: ExtensionContext): void {
    if (s_bundleDebounce) clearTimeout(s_bundleDebounce);
    s_bundleDebounce = setTimeout(() => {
        s_bundleDebounce = undefined;
        bundleDefaultTarget(context).catch(err => {
            window.showErrorMessage(`Enma bundleOnSave failed: ${(err as Error).message}`);
        });
    }, BUNDLE_ON_SAVE_DEBOUNCE_MS);
}

export function registerBundler(context: ExtensionContext): void {
    context.subscriptions.push(
        commands.registerCommand('enma.bundle', () => cmdBundle(context)),
        commands.registerCommand('enma.bundleStripped', () => cmdBundle(context, true)),
        commands.registerCommand('enma.bundleProject', () => cmdBundleProject(context)),
        commands.registerCommand('enma.bundleAll', () => cmdBundleAll(context)),
        commands.registerCommand('enma.initProject', () => cmdInitProject()),
        tasks.registerTaskProvider('enma-bundle', new EnmaBundleTaskProvider(context)),
        workspace.onDidSaveTextDocument(doc => {
            if (!readBundleOnSave()) return;
            if (doc.languageId !== 'enma') return;
            scheduleBundleOnSave(context);
        }),
    );
}
