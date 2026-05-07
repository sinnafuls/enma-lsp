// Document symbol provider — outline tree for the current file.
//
// Walks the AST of NodeScript and emits SymbolInformation/DocumentSymbol for
// each top-level decl, with nested members for class/struct/interface/enum.

import * as lsp from 'vscode-languageserver';

import { NodeScript, NodeKind, NodeTopLevel, NodeMember, NodeNamespace } from '../compiler_parser/nodes';
import { TextRange } from '../compiler_tokenizer/textLocation';

function rangeToLsp(r: TextRange): lsp.Range {
    return {
        start: { line: r.start.line, character: r.start.character },
        end: { line: r.end.line, character: r.end.character },
    };
}

export function provideDocumentSymbol(ast: NodeScript): lsp.DocumentSymbol[] {
    const out: lsp.DocumentSymbol[] = [];
    for (const child of ast.children) {
        const sym = topLevelToSymbol(child);
        if (sym !== undefined) out.push(sym);
    }
    return out;
}

function topLevelToSymbol(node: NodeTopLevel): lsp.DocumentSymbol | undefined {
    switch (node.kind) {
        case NodeKind.Class: case NodeKind.Struct: case NodeKind.Interface: {
            const kind = node.kind === NodeKind.Class
                ? lsp.SymbolKind.Class
                : node.kind === NodeKind.Struct
                ? lsp.SymbolKind.Struct
                : lsp.SymbolKind.Interface;
            const members: lsp.DocumentSymbol[] = [];
            for (const m of node.members) {
                const ms = memberToSymbol(m);
                if (ms !== undefined) members.push(ms);
            }
            return {
                name: node.name.text,
                kind,
                range: rangeToLsp(node.range),
                selectionRange: rangeToLsp(node.name.location),
                children: members,
            };
        }
        case NodeKind.Enum: {
            const values: lsp.DocumentSymbol[] = node.values.map(v => ({
                name: v.name.text,
                kind: lsp.SymbolKind.EnumMember,
                range: rangeToLsp(v.range),
                selectionRange: rangeToLsp(v.name.location),
            }));
            return {
                name: node.name.text,
                kind: lsp.SymbolKind.Enum,
                range: rangeToLsp(node.range),
                selectionRange: rangeToLsp(node.name.location),
                children: values,
            };
        }
        case NodeKind.Function: case NodeKind.Coroutine:
            return {
                name: node.name.text,
                kind: lsp.SymbolKind.Function,
                range: rangeToLsp(node.range),
                selectionRange: rangeToLsp(node.name.location),
            };
        case NodeKind.Var:
            return {
                name: node.name.text,
                kind: lsp.SymbolKind.Variable,
                range: rangeToLsp(node.range),
                selectionRange: rangeToLsp(node.name.location),
            };
        case NodeKind.Namespace: {
            const ns = node as NodeNamespace;
            const children: lsp.DocumentSymbol[] = [];
            for (const c of ns.children) {
                const cs = topLevelToSymbol(c);
                if (cs !== undefined) children.push(cs);
            }
            return {
                name: ns.name.text,
                kind: lsp.SymbolKind.Namespace,
                range: rangeToLsp(ns.range),
                selectionRange: rangeToLsp(ns.name.location),
                children,
            };
        }
        case NodeKind.Mixin:
            return {
                name: node.name.text,
                kind: lsp.SymbolKind.Class,
                range: rangeToLsp(node.range),
                selectionRange: rangeToLsp(node.name.location),
            };
        case NodeKind.Delegate:
            return {
                name: node.name.text,
                kind: lsp.SymbolKind.Function,
                range: rangeToLsp(node.range),
                selectionRange: rangeToLsp(node.name.location),
            };
        case NodeKind.Typedef:
            return {
                name: node.name.text,
                kind: lsp.SymbolKind.TypeParameter,
                range: rangeToLsp(node.range),
                selectionRange: rangeToLsp(node.name.location),
            };
        default:
            return undefined;
    }
}

function memberToSymbol(m: NodeMember): lsp.DocumentSymbol | undefined {
    switch (m.kind) {
        case NodeKind.Field:
            return {
                name: m.name.text,
                kind: lsp.SymbolKind.Field,
                range: rangeToLsp(m.range),
                selectionRange: rangeToLsp(m.name.location),
            };
        case NodeKind.Method:
            return {
                name: m.name.text,
                kind: lsp.SymbolKind.Method,
                range: rangeToLsp(m.range),
                selectionRange: rangeToLsp(m.name.location),
            };
        case NodeKind.Constructor:
            return {
                name: m.name.text,
                kind: lsp.SymbolKind.Constructor,
                range: rangeToLsp(m.range),
                selectionRange: rangeToLsp(m.name.location),
            };
        case NodeKind.Destructor:
            return {
                name: '~' + m.name.text,
                kind: lsp.SymbolKind.Method,
                range: rangeToLsp(m.range),
                selectionRange: rangeToLsp(m.name.location),
            };
        case NodeKind.Property:
            return {
                name: m.name.text,
                kind: lsp.SymbolKind.Property,
                range: rangeToLsp(m.range),
                selectionRange: rangeToLsp(m.name.location),
            };
        case NodeKind.Class: case NodeKind.Struct: case NodeKind.Interface: case NodeKind.Enum:
            return topLevelToSymbol(m as NodeTopLevel);
        default:
            return undefined;
    }
}
