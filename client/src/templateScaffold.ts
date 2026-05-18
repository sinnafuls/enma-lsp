// `Enma: Scaffold From Template…` and `Enma: Generate CI Workflow` commands.
//
// Seed templates live inline (Map<path, contents>) so the entire payload
// ships inside the bundled extension.js — no resource lookup, no asset
// pipeline. Adding a template is a single Map entry.

import * as fs from 'fs';
import * as path from 'path';
import {
    ExtensionContext,
    QuickPickItem,
    Uri,
    commands,
    window,
    workspace,
} from 'vscode';

interface SeedTemplate {
    readonly id: string;
    readonly description: string;
    readonly files: ReadonlyMap<string, string>;
}

const PERCEPTION_MINIMAL: SeedTemplate = {
    id: 'perception-minimal',
    description: 'Single-file render routine with sidebar boilerplate',
    files: new Map<string, string>([
        ['source/main.em', [
            '// Perception minimal — single-file starter.',
            '// Hit Ctrl+Alt+B to bundle into output/bundled.em.',
            '',
            'import "color";',
            'import "vec";',
            '',
            'int64 g_tick;',
            '',
            'void my_draw(int64 data) {',
            '    g_tick = g_tick + 1;',
            '    color fg = color(255, 255, 255, 255);',
            '    color bg = color(0,   0,   0,   0);',
            '    string text = "tick=" + cast<string>(g_tick);',
            '    draw_text(text, vec2(40.0, 40.0), fg, get_font20(), 0, bg, 0.0);',
            '}',
            '',
            'int64 main() {',
            '    g_tick = 0;',
            '    register_routine(cast<int64>(my_draw), 0);',
            '    return 1;',
            '}',
            '',
        ].join('\n')],
        ['.vscode/tasks.json', JSON.stringify({
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
        }, null, 4) + '\n'],
    ]),
};

const PERCEPTION_MULTI: SeedTemplate = {
    id: 'perception-multi',
    description: 'Multi-file project with #include chains across feature folders',
    files: new Map<string, string>([
        ['source/main.em', [
            '#include "lib/render.em"',
            '#include "lib/state.em"',
            '',
            'int64 main() {',
            '    state_init();',
            '    register_routine(cast<int64>(render_frame), 0);',
            '    return 1;',
            '}',
            '',
        ].join('\n')],
        ['source/lib/render.em', [
            '// Render hooks.',
            'import "color";',
            'import "vec";',
            '',
            'void render_frame(int64 data) {',
            '    color fg = color(255, 255, 255, 255);',
            '    color bg = color(0,   0,   0,   0);',
            '    draw_text("hello", vec2(40.0, 40.0), fg, get_font20(), 0, bg, 0.0);',
            '}',
            '',
        ].join('\n')],
        ['source/lib/state.em', [
            '// Shared mutable state.',
            'int64 g_frame;',
            '',
            'void state_init() {',
            '    g_frame = 0;',
            '}',
            '',
        ].join('\n')],
        ['.vscode/tasks.json', JSON.stringify({
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
        }, null, 4) + '\n'],
    ]),
};

const TEMPLATES: ReadonlyArray<SeedTemplate> = [PERCEPTION_MINIMAL, PERCEPTION_MULTI];

function workspaceRootFsPath(): string | undefined {
    const folders = workspace.workspaceFolders;
    if (!folders || folders.length === 0) return undefined;
    return folders[0].uri.fsPath;
}

async function scaffoldCommand(): Promise<void> {
    const root = workspaceRootFsPath();
    if (!root) {
        window.showErrorMessage('Enma: open a workspace folder first.');
        return;
    }
    const items: QuickPickItem[] = TEMPLATES.map(t => ({
        label: t.id,
        description: t.description,
    }));
    const pick = await window.showQuickPick(items, { placeHolder: 'Pick an Enma template' });
    if (!pick) return;

    const template = TEMPLATES.find(t => t.id === pick.label);
    if (!template) return;

    let written = 0;
    let skipped = 0;
    for (const [rel, contents] of template.files) {
        const abs = path.join(root, rel);
        if (fs.existsSync(abs)) { skipped++; continue; }
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, contents, 'utf8');
        written++;
    }
    window.showInformationMessage(
        `Enma template '${template.id}' scaffolded: ${written} file(s) written, ${skipped} skipped (already existed).`,
    );

    const entry = template.files.has('source/main.em') ? 'source/main.em' : Array.from(template.files.keys())[0];
    const doc = await workspace.openTextDocument(Uri.file(path.join(root, entry)));
    await window.showTextDocument(doc);
}

const CI_WORKFLOW = `# Generated by Enma: Generate CI Workflow.
# Runs the bundler for every project listed in enma.projects (or the default
# src/out pair when no projects are configured), uploads the bundled output
# as a workflow artifact, and fails the build on a bundler non-zero exit.

name: Enma bundle

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  bundle:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Bundle (default project)
        run: |
          node scripts/bundler.mjs source output/bundled.em --strip
        if: \${{ !contains(github.event.pull_request.title, '[skip-bundle]') }}

      - name: Upload bundled output
        uses: actions/upload-artifact@v4
        with:
          name: enma-bundled-em
          path: |
            output/
            **/bundled.em
          if-no-files-found: ignore
`;

async function generateCiWorkflowCommand(): Promise<void> {
    const root = workspaceRootFsPath();
    if (!root) {
        window.showErrorMessage('Enma: open a workspace folder first.');
        return;
    }
    const dir = path.join(root, '.github', 'workflows');
    const file = path.join(dir, 'enma.yml');
    if (fs.existsSync(file)) {
        const overwrite = await window.showWarningMessage(
            `${path.relative(root, file)} already exists. Overwrite?`,
            'Overwrite', 'Cancel',
        );
        if (overwrite !== 'Overwrite') return;
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, CI_WORKFLOW, 'utf8');
    window.showInformationMessage(`Enma: wrote ${path.relative(root, file)}.`);
    const doc = await workspace.openTextDocument(Uri.file(file));
    await window.showTextDocument(doc);
}

export function registerTemplateScaffold(context: ExtensionContext): void {
    context.subscriptions.push(
        commands.registerCommand('enma.template.scaffold', scaffoldCommand),
        commands.registerCommand('enma.template.ci', generateCiWorkflowCommand),
    );
}
