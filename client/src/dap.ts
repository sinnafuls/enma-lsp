// Enma DAP attach factory.
//
// We don't implement a DAP adapter — the upstream Perception engine is the DAP
// server. The factory simply maps an `attach` debug configuration onto a TCP
// connection at `host:port` (default `localhost:27979`, matching the Enma
// SDK's published default). VSCode handles the wire protocol itself once it
// has a `DebugAdapterServer` descriptor.
//
// If nothing is listening, VSCode surfaces the ECONNREFUSED in the Debug
// Console. We don't pre-flight the connection on every attach — it would race
// the actual session start and produce duplicate errors.

import {
    DebugAdapterDescriptor,
    DebugAdapterDescriptorFactory,
    DebugAdapterServer,
    DebugConfiguration,
    DebugConfigurationProvider,
    DebugSession,
    ExtensionContext,
    debug,
} from 'vscode';

const DEBUG_TYPE = 'enma-lsp-dap';
const DEFAULT_HOST = 'localhost';
const DEFAULT_PORT = 27979;

class EnmaDapFactory implements DebugAdapterDescriptorFactory {
    public createDebugAdapterDescriptor(session: DebugSession): DebugAdapterDescriptor {
        const cfg = session.configuration as { address?: string; port?: number };
        const host = cfg.address ?? DEFAULT_HOST;
        const port = cfg.port ?? DEFAULT_PORT;
        return new DebugAdapterServer(port, host);
    }
}

class EnmaDapConfigProvider implements DebugConfigurationProvider {
    public resolveDebugConfiguration(_folder: unknown, configuration: DebugConfiguration): DebugConfiguration {
        // Provide attach-friendly defaults when the user hits F5 with an empty
        // config: VSCode hands us `{}` and we fill in the canonical defaults.
        if (!configuration.type) configuration.type = DEBUG_TYPE;
        if (!configuration.request) configuration.request = 'attach';
        if (!configuration.name) configuration.name = 'Attach to Enma DAP server';
        if (!configuration.address) configuration.address = DEFAULT_HOST;
        if (!configuration.port) configuration.port = DEFAULT_PORT;
        return configuration;
    }
}

export function registerDap(context: ExtensionContext): void {
    context.subscriptions.push(
        debug.registerDebugAdapterDescriptorFactory(DEBUG_TYPE, new EnmaDapFactory()),
        debug.registerDebugConfigurationProvider(DEBUG_TYPE, new EnmaDapConfigProvider()),
    );
}
