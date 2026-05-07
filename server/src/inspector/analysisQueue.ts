// Phase 5 — priority-banded queue for analyzer task scheduling.
//
// Three internal arrays (high / medium / low). pop() prefers high → medium →
// low; FIFO within each band. A `Set<T>` is maintained for O(1) `has()` so
// the resolver can dedupe re-requests cheaply.
//
// Ported (in spirit) from angel-lsp's analysisQueue.ts; the priority labels
// are renamed to match the §Phase 5 PRD vocabulary.

export type Priority = 'high' | 'medium' | 'low';

export class AnalysisQueue<T> {
    private _high: T[] = [];
    private _medium: T[] = [];
    private _low: T[] = [];
    private _set: Set<T> = new Set();

    public push(item: T, priority: Priority): void {
        if (this._set.has(item)) {
            // Already queued — leave at its current band so we don't reorder.
            // Resolver may explicitly remove + re-push to bump priority.
            return;
        }
        this._set.add(item);
        if (priority === 'high') this._high.push(item);
        else if (priority === 'medium') this._medium.push(item);
        else this._low.push(item);
    }

    public pop(): T | undefined {
        let item: T | undefined;
        if (this._high.length > 0) item = this._high.shift();
        else if (this._medium.length > 0) item = this._medium.shift();
        else if (this._low.length > 0) item = this._low.shift();
        if (item !== undefined) this._set.delete(item);
        return item;
    }

    public has(item: T): boolean {
        return this._set.has(item);
    }

    public remove(item: T): void {
        if (!this._set.has(item)) return;
        this._set.delete(item);
        const trim = (arr: T[]) => {
            const i = arr.indexOf(item);
            if (i >= 0) arr.splice(i, 1);
        };
        trim(this._high);
        trim(this._medium);
        trim(this._low);
    }

    public size(): number {
        return this._set.size;
    }

    public clear(): void {
        this._high = [];
        this._medium = [];
        this._low = [];
        this._set.clear();
    }
}
