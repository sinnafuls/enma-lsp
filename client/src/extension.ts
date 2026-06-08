import * as path from 'path';
import {
    commands,
    workspace,
    ExtensionContext,
    ConfigurationTarget,
    StatusBarAlignment,
    ThemeColor,
    window,
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

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
    const serverModule = context.asAbsolutePath(
        path.join('server', 'dist', 'server.js')
    );

    const serverOptions: ServerOptions = {
        run: {module: serverModule, transport: TransportKind.ipc},
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: {execArgv: ['--nolazy', '--inspect=6009']},
        },
    };

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            {scheme: 'file', language: 'enma'},
            {scheme: 'file', language: 'enma-predefined'},
        ],
        synchronize: {
            fileEvents: workspace.createFileSystemWatcher('**/*.{em,em.predefined}'),
        },
    };

    client = new LanguageClient(
        'enma',
        'Enma Language Server',
        serverOptions,
        clientOptions
    );

    client.start();

    // Bundler commands + task provider (Ctrl+Alt+B etc).
    registerBundler(context);

    // Perception API docs in-extension webview ("Enma: Open Perception Docs").
    registerDocsViewer(context);

    // QuickFix: insert missing `import "<module>";` for catalogue-known names.
    registerAutoImport(context);

    // Engine MCP: `Enma: Run Script` + on-save engine validation.
    registerEngineMcp(context);

    // DAP attach: forward `attach` debug sessions to the Perception engine.
    registerDap(context);

    // Templates: scaffold seed projects + emit a Bundle CI workflow.
    registerTemplateScaffold(context);

    // Predefined editor + snapshot diff helpers.
    registerPredefinedAndSnapshot(context);

    // Perception-specific reference webviews.
    registerAobExplorer(context);
    registerZydisPlayground(context);
    registerUnicornPanel(context);

    // MCP reverse-engineering commands (AOB search, disasm, symbol lookup, exports).
    registerReCommands(context);

    // .emb binary module inspector.
    registerEmbInspector(context);

    // §A11 Permissions banner: watch for workspace-scope flips of
    // enma.permissions.ffi or enma.permissions.file.
    context.subscriptions.push(
        workspace.onDidChangeConfiguration(async (e) => {
            if (!e.affectsConfiguration('enma.permissions')) return;

            const config = workspace.getConfiguration('enma.permissions');
            const ffiEnabled = config.get<boolean>('ffi', false);
            const fileEnabled = config.get<boolean>('file', false);

            if (!ffiEnabled && !fileEnabled) {
                // Both are off — nothing to do.
                return;
            }

            // Check workspace trust before allowing the permission flip.
            const isTrusted = workspace.isTrusted;
            if (!isTrusted) {
                // Revert the setting and show banner.
                const changedKey = ffiEnabled ? 'ffi' : 'file';
                await revertAndShowBanner(changedKey, ffiEnabled, fileEnabled);
                return;
            }

            // Workspace is already trusted — send effective settings to server.
            sendPermissionsToServer(ffiEnabled, fileEnabled);
        })
    );

    // §MCP status bar — shows live connection state.
    const mcpBar = window.createStatusBarItem(StatusBarAlignment.Right, 100);
    mcpBar.text = '$(plug) Enma MCP';
    mcpBar.tooltip = `Enma MCP: ${discoverMcpEndpoint(
        workspace.getConfiguration('enma.mcp').get<string>('endpoint') || undefined,
    )}`;
    mcpBar.show();
    context.subscriptions.push(mcpBar);

    const refreshMcpStatus = async (): Promise<void> => {
        const ep = discoverMcpEndpoint(
            workspace.getConfiguration('enma.mcp').get<string>('endpoint') || undefined,
        );
        mcpBar.tooltip = `Enma MCP: ${ep}`;
        const ok = await testMcpConnection(ep);
        if (ok) {
            mcpBar.text = '$(plug) Enma';
            mcpBar.backgroundColor = undefined;
        } else {
            mcpBar.text = '$(error) Enma MCP';
            mcpBar.backgroundColor = new ThemeColor('statusBarItem.errorBackground');
        }
    };

    // Initial probe — async, non-blocking.
    refreshMcpStatus().catch(() => {/* status bar stays at default on error */});

    context.subscriptions.push(
        commands.registerCommand('enma.reconnectMcp', () => {
            refreshMcpStatus().catch(() => {/* status bar stays at default on error */});
        }),
        workspace.onDidChangeConfiguration(e => {
            if (!e.affectsConfiguration('enma.mcp')) return;
            refreshMcpStatus().catch(() => {/* status bar stays at default on error */});
        }),
    );
}

/**
 * Revert a permission flip, show a warning banner, and optionally request
 * workspace trust. If the user clicks "Trust this workspace", we re-apply
 * the setting after trust is granted.
 */
async function revertAndShowBanner(
    changedKey: 'ffi' | 'file',
    ffiEnabled: boolean,
    fileEnabled: boolean,
): Promise<void> {
    const config = workspace.getConfiguration('enma.permissions');

    // Revert immediately — send safe values to server.
    sendPermissionsToServer(false, false);

    const permName = changedKey === 'ffi'
        ? 'FFI / [[dll]] bindings'
        : 'file-system intrinsics';

    const choice = await window.showWarningMessage(
        `Enma: enabling ${permName} requires workspace trust. ` +
        `This setting will not take effect until you trust this workspace.`,
        'Trust this workspace',
        'Cancel',
    );

    if (choice === 'Trust this workspace') {
        // Request workspace trust from VS Code.
        let trusted = workspace.isTrusted;
        if (!trusted) {
            try {
                // requestWorkspaceTrust is available in VS Code ≥1.57.
                const api = workspace as unknown as {
                    requestWorkspaceTrust?: (opts?: { modal: boolean }) => Promise<boolean | undefined>
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
            // Re-apply the setting now that the workspace is trusted.
            await config.update(changedKey, changedKey === 'ffi' ? ffiEnabled : fileEnabled, ConfigurationTarget.Workspace);
            sendPermissionsToServer(
                changedKey === 'ffi' ? ffiEnabled : config.get<boolean>('ffi', false),
                changedKey === 'file' ? fileEnabled : config.get<boolean>('file', false),
            );
        } else {
            // Trust was denied — revert the setting.
            await config.update(changedKey, false, ConfigurationTarget.Workspace);
            sendPermissionsToServer(false, false);
        }
    } else {
        // User clicked Cancel — revert the setting.
        await config.update(changedKey, false, ConfigurationTarget.Workspace);
        sendPermissionsToServer(false, false);
    }
}

/**
 * Send effective permission settings to the language server.
 * The server's `setAnalyzerPermissions` notification accepts { ffi, file }.
 */
function sendPermissionsToServer(ffi: boolean, file: boolean): void {
    if (!client) return;
    client.sendNotification('enma/setAnalyzerPermissions', { ffi, file });
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) return undefined;
    return client.stop();
}
