// VS Code client entry — structured 1:1 with angel-lsp-pcx (AngelScript → Enma).
// Extra Enma-only surfaces (MCP, AOB, Zydis, Unicorn, emb) register after the
// shared Perception authoring loop.

import * as path from 'path';
import {
    commands,
    workspace,
    window,
    ExtensionContext,
    ConfigurationTarget,
    StatusBarAlignment,
    StatusBarItem,
    ThemeColor,
    TextEditor,
    QuickPickItemKind,
    QuickPickItem,
} from 'vscode';

import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from 'vscode-languageclient/node';

import { registerBundler } from './bundler';
import { registerDocsViewer } from './docsViewer';
import { registerAutoImport } from './autoImport';
import { registerEngineMcp } from './runScript';
import { registerDap } from './dap';
import { registerTemplateScaffold } from './templateScaffold';
import { registerPredefinedAndSnapshot } from './predefinedAndSnapshot';
import { registerAobExplorer } from './aobExplorer';
import { registerZydisPlayground } from './zydisPlayground';
import { registerUnicornPanel } from './unicornPanel';
import { registerReCommands } from './mcpReverseEngineering';
import { registerEmbInspector } from './embInspector';
import { testMcpConnection, discoverMcpEndpoint } from './mcpClient';

let s_client: LanguageClient | undefined;
let s_statusBar: StatusBarItem | undefined;
let s_mcpBar: StatusBarItem | undefined;

// ─────────────────────────────────────────────────────────────────────────────
// Multi-project configuration (angel-lsp-pcx shape)
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectInfo {
    name: string;
    sourceDirectory: string;
    outputFile: string;
    stripComments: boolean;
    lspMode: 'full' | 'syntaxOnly';
}

function getProjects(): ProjectInfo[] {
    const config = workspace.getConfiguration('enma');
    const projects = config.get<ProjectInfo[]>('projects', []);
    return projects.filter(p => p.name && p.sourceDirectory && p.outputFile);
}

// ─────────────────────────────────────────────────────────────────────────────
// Activation
// ─────────────────────────────────────────────────────────────────────────────

export function activate(context: ExtensionContext): void {
    const serverModule = context.asAbsolutePath(
        path.join('server', 'dist', 'server.js'),
    );

    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: { execArgv: ['--nolazy', '--inspect=6009'] },
        },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { scheme: 'file', language: 'enma' },
            { scheme: 'file', language: 'enma-predefined' },
        ],
        synchronize: {
            fileEvents: workspace.createFileSystemWatcher('**/*.{em,em.predefined}'),
        },
    };

    s_client = new LanguageClient(
        'enma',
        'Enma Language Server',
        serverOptions,
        clientOptions,
    );

    // angel-lsp-pcx parity: reserved smart-backspace request slot
    s_client.onRequest('enma/smartBackspace', () => { /* reserved */ });

    setupStatusBar(context);
    registerCoreCommands(context);

    // Bundler + init project (Ctrl+Alt+B etc.) — same surface as angel
    registerBundler(context);

    // Docs: browser open (angel) + optional in-extension panel
    registerDocsViewer(context);

    // Enma-only extras (keep; angel has no equivalent)
    registerAutoImport(context);
    registerEngineMcp(context);
    registerDap(context);
    registerTemplateScaffold(context);
    registerPredefinedAndSnapshot(context);
    registerAobExplorer(context);
    registerZydisPlayground(context);
    registerUnicornPanel(context);
    registerReCommands(context);
    registerEmbInspector(context);

    registerPermissionsGate(context);
    setupMcpStatusBar(context);

    s_client.start().then(() => {
        s_client!.onNotification(
            'enma/indexProgress',
            ({ scanned, total }: { scanned: number; total: number }) => {
                if (!s_statusBar) return;
                if (scanned < total) {
                    s_statusBar.text = `$(sync~spin) Indexing (${scanned}/${total})`;
                    s_statusBar.tooltip = 'Perception Enma — indexing workspace files...';
                    s_statusBar.show();
                } else {
                    s_statusBar.text = '$(code) Perception Enma';
                    s_statusBar.tooltip = 'Perception Enma — click for commands';
                }
            },
        );
    });
}

export function deactivate(): Thenable<void> | undefined {
    s_statusBar?.dispose();
    s_mcpBar?.dispose();
    if (!s_client) return undefined;
    return s_client.stop();
}

// ─────────────────────────────────────────────────────────────────────────────
// Status bar (angel-lsp-pcx 1:1 — left, language-gated, command menu)
// ─────────────────────────────────────────────────────────────────────────────

function setupStatusBar(context: ExtensionContext): void {
    s_statusBar = window.createStatusBarItem(StatusBarAlignment.Left, 0);
    s_statusBar.text = '$(code) Perception Enma';
    s_statusBar.tooltip = 'Perception Enma — click for commands';
    s_statusBar.command = 'enma.statusBarMenu';
    context.subscriptions.push(s_statusBar);

    context.subscriptions.push(
        commands.registerCommand('enma.statusBarMenu', showStatusBarMenu),
    );

    const updateVisibility = (editor: TextEditor | undefined) => {
        const lang = editor?.document.languageId;
        if (lang === 'enma' || lang === 'enma-predefined') {
            s_statusBar!.show();
        } else {
            s_statusBar!.hide();
        }
    };

    context.subscriptions.push(window.onDidChangeActiveTextEditor(updateVisibility));
    updateVisibility(window.activeTextEditor);
}

type MenuEntry = QuickPickItem & { command?: string };

function sep(label: string): MenuEntry {
    return { label, kind: QuickPickItemKind.Separator };
}

async function showStatusBarMenu(): Promise<void> {
    const projects = getProjects();
    const mcpOn = workspace.getConfiguration('enma.mcp').get<boolean>('enabled', false);
    const items: MenuEntry[] = [];

    // ── Bundle (angel core) ──────────────────────────────────────────────
    items.push(sep('Bundle'));
    if (projects.length > 0) {
        items.push(
            {
                label: '$(package) Bundle Project...',
                detail: 'Pick a project to bundle',
                command: 'enma.bundleProject',
            },
            {
                label: '$(package) Bundle All Projects',
                detail: `Bundle all ${projects.length} projects`,
                command: 'enma.bundleAll',
            },
        );
    }
    items.push(
        { label: '$(package) Bundle Script', detail: 'Ctrl+Alt+B', command: 'enma.bundle' },
        {
            label: '$(package) Bundle Script (Strip Comments)',
            detail: 'Ctrl+Alt+Shift+B',
            command: 'enma.bundleStripped',
        },
        {
            label: '$(rocket) Initialize Project',
            detail: 'Scaffold tasks.json + source/main.em',
            command: 'enma.initProject',
        },
        {
            label: '$(file-code) Scaffold From Template…',
            detail: 'perception-minimal / multi',
            command: 'enma.template.scaffold',
        },
        {
            label: '$(github-action) Generate CI Workflow',
            detail: '.github/workflows/enma.yml',
            command: 'enma.template.ci',
        },
    );

    // ── Engine MCP (Enma-only — Perception host bridge) ───────────────────
    items.push(sep(`Engine MCP ${mcpOn ? '(on)' : '(off)'}`));
    items.push(
        {
            label: '$(play) Run Script',
            detail: 'script/execute — Ctrl+Alt+R',
            description: mcpOn ? 'ready' : 'enable MCP',
            command: 'enma.runScript',
        },
        {
            label: '$(check) Validate Script',
            detail: 'script/validate now (also on-save when enabled)',
            command: 'enma.validateScript',
        },
        {
            label: '$(symbol-namespace) Get Engine Context',
            detail: 'script/get_context — live host declarations',
            command: 'enma.getContext',
        },
        {
            label: '$(debug-disconnect) Reconnect MCP',
            detail: 'Re-probe endpoint + refresh status',
            command: 'enma.reconnectMcp',
        },
        {
            label: '$(settings-gear) MCP Settings',
            detail: 'enma.mcp.*',
            command: 'enma.openMcpSettings',
        },
    );

    // ── Reverse engineering (MCP process tools) ──────────────────────────
    items.push(sep('Reverse engineering (MCP)'));
    items.push(
        {
            label: '$(search) AOB / Pattern Search',
            detail: 'process/find_pattern',
            command: 'enma.aobSearch',
        },
        {
            label: '$(list-flat) Disassemble',
            detail: 'process/disassemble',
            command: 'enma.disassemble',
        },
        {
            label: '$(symbol-method) Lookup Symbol',
            detail: 'process/lookup_symbol',
            command: 'enma.lookupSymbol',
        },
        {
            label: '$(export) List Module Exports',
            detail: 'process/list_module_exports',
            command: 'enma.listExports',
        },
        {
            label: '$(regex) AOB Pattern Explorer',
            detail: 'Local hex/IDA pattern decoder webview',
            command: 'enma.aob.explore',
        },
    );

    // ── Reference panels ─────────────────────────────────────────────────
    items.push(sep('Reference'));
    items.push(
        {
            label: '$(circuit-board) Zydis Playground',
            detail: 'encode / disasm reference',
            command: 'enma.zydis.playground',
        },
        {
            label: '$(server-process) Unicorn Panel',
            detail: 'cpu_t / hooks reference',
            command: 'enma.unicorn.panel',
        },
        {
            label: '$(file-binary) Inspect .emb',
            detail: 'Binary module inspector',
            command: 'enma.inspectEmb',
        },
        {
            label: '$(edit) Edit Project em.predefined',
            command: 'enma.predefined.edit',
        },
        {
            label: '$(diff) Diff With Snapshot…',
            command: 'enma.snapshot.diff',
        },
    );

    // ── Docs / settings (angel core) ─────────────────────────────────────
    items.push(sep('Docs & settings'));
    items.push(
        {
            label: '$(book) Open Perception Docs',
            detail: 'docs.perception.cx/perception',
            command: 'enma.openDocs',
        },
        {
            label: '$(book) Open Enma Language Docs',
            detail: 'docs.perception.cx/perception/enma-lang',
            command: 'enma.openLangDocs',
        },
        {
            label: '$(book) Docs Panel (offline)',
            detail: 'Bundled webview',
            command: 'enma.openDocsPanel',
        },
        { label: '$(gear) View Settings', detail: 'enma.*', command: 'enma.openSettings' },
    );

    const pick = await window.showQuickPick(items, {
        placeHolder: 'Perception Enma — full toolkit',
        matchOnDetail: true,
        matchOnDescription: true,
    });
    if (pick?.command) commands.executeCommand(pick.command);
}

function registerCoreCommands(context: ExtensionContext): void {
    context.subscriptions.push(
        commands.registerCommand('enma.openSettings', () =>
            commands.executeCommand('workbench.action.openSettings', 'enma'),
        ),
        commands.registerCommand('enma.openMcpSettings', () =>
            commands.executeCommand('workbench.action.openSettings', 'enma.mcp'),
        ),
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Permissions gate (Enma-only)
// ─────────────────────────────────────────────────────────────────────────────

function registerPermissionsGate(context: ExtensionContext): void {
    context.subscriptions.push(
        workspace.onDidChangeConfiguration(async (e) => {
            if (!e.affectsConfiguration('enma.permissions')) return;

            const config = workspace.getConfiguration('enma.permissions');
            const ffiEnabled = config.get<boolean>('ffi', false);
            const fileEnabled = config.get<boolean>('file', false);

            if (!ffiEnabled && !fileEnabled) return;

            if (!workspace.isTrusted) {
                const changedKey = ffiEnabled ? 'ffi' : 'file';
                await revertAndShowBanner(changedKey, ffiEnabled, fileEnabled);
                return;
            }

            sendPermissionsToServer(ffiEnabled, fileEnabled);
        }),
    );
}

async function revertAndShowBanner(
    changedKey: 'ffi' | 'file',
    ffiEnabled: boolean,
    fileEnabled: boolean,
): Promise<void> {
    const config = workspace.getConfiguration('enma.permissions');
    sendPermissionsToServer(false, false);

    const permName =
        changedKey === 'ffi' ? 'FFI / [[dll]] bindings' : 'file-system intrinsics';

    const choice = await window.showWarningMessage(
        `Enma: enabling ${permName} requires workspace trust. ` +
            `This setting will not take effect until you trust this workspace.`,
        'Trust this workspace',
        'Cancel',
    );

    if (choice === 'Trust this workspace') {
        let trusted = workspace.isTrusted;
        if (!trusted) {
            try {
                const api = workspace as unknown as {
                    requestWorkspaceTrust?: (opts?: { modal: boolean }) => Promise<boolean | undefined>;
                };
                if (typeof api.requestWorkspaceTrust === 'function') {
                    const result = await api.requestWorkspaceTrust({ modal: true });
                    trusted = result === true;
                }
            } catch {
                trusted = workspace.isTrusted;
            }
        }

        if (trusted) {
            await config.update(
                changedKey,
                changedKey === 'ffi' ? ffiEnabled : fileEnabled,
                ConfigurationTarget.Workspace,
            );
            sendPermissionsToServer(
                changedKey === 'ffi' ? ffiEnabled : config.get<boolean>('ffi', false),
                changedKey === 'file' ? fileEnabled : config.get<boolean>('file', false),
            );
        } else {
            await config.update(changedKey, false, ConfigurationTarget.Workspace);
            sendPermissionsToServer(false, false);
        }
    } else {
        await config.update(changedKey, false, ConfigurationTarget.Workspace);
        sendPermissionsToServer(false, false);
    }
}

function sendPermissionsToServer(ffi: boolean, file: boolean): void {
    if (!s_client) return;
    s_client.sendNotification('enma/setAnalyzerPermissions', { ffi, file });
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP status (right) — Enma-only companion to left Perception bar
// ─────────────────────────────────────────────────────────────────────────────

function setupMcpStatusBar(context: ExtensionContext): void {
    s_mcpBar = window.createStatusBarItem(StatusBarAlignment.Right, 100);
    s_mcpBar.text = '$(plug) Enma MCP';
    s_mcpBar.command = 'enma.mcpStatusMenu';
    s_mcpBar.tooltip = 'Enma MCP — click for engine tools';
    s_mcpBar.show();
    context.subscriptions.push(s_mcpBar);

    const refreshMcpStatus = async (): Promise<void> => {
        const cfg = workspace.getConfiguration('enma.mcp');
        const enabled = cfg.get<boolean>('enabled', false);
        const ep = discoverMcpEndpoint(cfg.get<string>('endpoint') || undefined);

        if (!enabled) {
            s_mcpBar!.text = '$(debug-disconnect) Enma MCP off';
            s_mcpBar!.tooltip = `MCP disabled — click to enable\n${ep}`;
            s_mcpBar!.backgroundColor = undefined;
            return;
        }

        s_mcpBar!.tooltip = `Enma MCP: ${ep}\nClick for Run / Validate / RE tools`;
        const ok = await testMcpConnection(ep);
        if (ok) {
            s_mcpBar!.text = '$(plug) Enma MCP';
            s_mcpBar!.backgroundColor = undefined;
        } else {
            s_mcpBar!.text = '$(error) Enma MCP';
            s_mcpBar!.backgroundColor = new ThemeColor('statusBarItem.errorBackground');
            s_mcpBar!.tooltip = `Unreachable: ${ep}\nClick to reconnect or open settings`;
        }
    };

    refreshMcpStatus().catch(() => { /* keep default */ });

    context.subscriptions.push(
        commands.registerCommand('enma.reconnectMcp', async () => {
            window.setStatusBarMessage('$(sync~spin) Probing Enma MCP…', 2000);
            await refreshMcpStatus();
        }),
        commands.registerCommand('enma.mcpStatusMenu', async () => {
            const cfg = workspace.getConfiguration('enma.mcp');
            const enabled = cfg.get<boolean>('enabled', false);
            const pick = await window.showQuickPick(
                [
                    {
                        label: enabled ? '$(circle-slash) Disable MCP' : '$(plug) Enable MCP',
                        command: 'toggle',
                    },
                    { label: '$(play) Run Script', command: 'enma.runScript' },
                    { label: '$(check) Validate Script', command: 'enma.validateScript' },
                    { label: '$(symbol-namespace) Get Engine Context', command: 'enma.getContext' },
                    { label: '$(search) AOB Search', command: 'enma.aobSearch' },
                    { label: '$(list-flat) Disassemble', command: 'enma.disassemble' },
                    { label: '$(debug-disconnect) Reconnect', command: 'enma.reconnectMcp' },
                    { label: '$(gear) MCP Settings', command: 'enma.openMcpSettings' },
                    { label: '$(menu) Full toolkit menu', command: 'enma.statusBarMenu' },
                ],
                { placeHolder: 'Enma MCP' },
            );
            if (!pick) return;
            if ((pick as { command: string }).command === 'toggle') {
                await cfg.update('enabled', !enabled, true);
                await refreshMcpStatus();
                return;
            }
            commands.executeCommand((pick as { command: string }).command);
        }),
        workspace.onDidChangeConfiguration((e) => {
            if (!e.affectsConfiguration('enma.mcp')) return;
            refreshMcpStatus().catch(() => { /* keep default */ });
        }),
    );
}
