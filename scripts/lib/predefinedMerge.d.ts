export interface CatalogueSymbol {
    module: string;
    name: string;
    kind: 'type' | 'function' | 'funcdef' | 'global';
    declaration: string;
    source?: string;
}

export interface MergeResult {
    added: CatalogueSymbol[];
    skipped: Array<{ symbol: CatalogueSymbol; reason: string }>;
    nextContent: string;
}

export function mergePredefined(
    existingContent: string,
    incoming: CatalogueSymbol[],
    todayISODate?: string,
): MergeResult;
