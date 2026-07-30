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

async function showStatusBarMenu(): Promise<void> {
    const projects = getProjects();
    const items: { label: string; detail: string; command: string }[] = [];

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
        { label: '$(play) Run Script (MCP)', detail: 'Engine MCP', command: 'enma.runScript' },
    );

    const pick = await window.showQuickPick(items, { placeHolder: 'Perception Enma' });
    if (pick) commands.executeCommand(pick.command);
}

function registerCoreCommands(context: ExtensionContext): void {
    context.subscriptions.push(
        commands.registerCommand('enma.openSettings', () =>
            commands.executeCommand('workbench.action.openSettings', 'enma'),
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
    s_mcpBar.tooltip = `Enma MCP: ${discoverMcpEndpoint(
        workspace.getConfiguration('enma.mcp').get<string>('endpoint') || undefined,
    )}`;
    s_mcpBar.show();
    context.subscriptions.push(s_mcpBar);

    const refreshMcpStatus = async (): Promise<void> => {
        const ep = discoverMcpEndpoint(
            workspace.getConfiguration('enma.mcp').get<string>('endpoint') || undefined,
        );
        s_mcpBar!.tooltip = `Enma MCP: ${ep}`;
        const ok = await testMcpConnection(ep);
        if (ok) {
            s_mcpBar!.text = '$(plug) Enma';
            s_mcpBar!.backgroundColor = undefined;
        } else {
            s_mcpBar!.text = '$(error) Enma MCP';
            s_mcpBar!.backgroundColor = new ThemeColor('statusBarItem.errorBackground');
        }
    };

    refreshMcpStatus().catch(() => { /* keep default */ });

    context.subscriptions.push(
        commands.registerCommand('enma.reconnectMcp', () => {
            refreshMcpStatus().catch(() => { /* keep default */ });
        }),
        workspace.onDidChangeConfiguration((e) => {
            if (!e.affectsConfiguration('enma.mcp')) return;
            refreshMcpStatus().catch(() => { /* keep default */ });
        }),
    );
}
