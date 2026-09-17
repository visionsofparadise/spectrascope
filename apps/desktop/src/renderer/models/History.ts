import { batch, createMutableState, flush, ignore, subscribe, type Operation } from "opshot";

export const replayMeta = Symbol("replay");

export const automaticMeta = Symbol("automatic");

export type DocumentMeta = string | typeof replayMeta | typeof automaticMeta | undefined;

interface HistoryEntry {
	readonly transactionKey: string;
	readonly operations: Array<Operation<DocumentMeta>>;
}

export interface History {
	index: number;
	length: number;
	readonly stack: Array<HistoryEntry>;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
	readonly undo: () => void;
	readonly redo: () => void;
}

export const MAX_HISTORY_ENTRIES = 100;

const revert = (operation: Operation<DocumentMeta>) => {
	if (operation.kind === "add") Reflect.deleteProperty(operation.node, operation.key);
	else operation.node[operation.key] = operation.before;
};

const apply = (operation: Operation<DocumentMeta>) => {
	if (operation.kind === "delete") Reflect.deleteProperty(operation.node, operation.key);
	else operation.node[operation.key] = operation.after;
};

export function createHistory(target: object): History {
	const history: History = createMutableState<History>({
		index: -1,
		length: 0,
		stack: ignore(new Array<HistoryEntry>()),
		get canUndo() {
			return this.index >= 0;
		},
		get canRedo() {
			return this.index < this.length - 1;
		},
		undo: () => {
			flush(target);

			const entry = history.stack[history.index];

			if (entry === undefined) return;

			batch(() => {
				for (const operation of [...entry.operations].reverse()) revert(operation);
			}, replayMeta);

			history.index -= 1;
		},
		redo: () => {
			flush(target);

			const entry = history.stack[history.index + 1];

			if (entry === undefined) return;

			batch(() => {
				for (const operation of entry.operations) apply(operation);
			}, replayMeta);

			history.index += 1;
		},
	});

	const record = (transactionKey: string | undefined, operations: ReadonlyArray<Operation<DocumentMeta>>) => {
		history.stack.splice(history.index + 1);

		const current = history.stack[history.index];

		if (transactionKey !== undefined && current?.transactionKey === transactionKey) {
			current.operations.push(...operations);
			history.length = history.stack.length;

			return;
		}

		history.stack.push({ transactionKey: transactionKey ?? crypto.randomUUID(), operations: [...operations] });

		if (history.stack.length > MAX_HISTORY_ENTRIES) {
			history.stack.shift();
			history.index -= 1;
		}

		history.index += 1;
		history.length = history.stack.length;
	};

	subscribe<DocumentMeta>(target, (operations) => {
		let run = new Array<Operation<DocumentMeta>>();
		let runMeta: DocumentMeta;

		const recordRun = () => {
			if (run.length === 0) return;

			if (runMeta !== replayMeta && runMeta !== automaticMeta) record(runMeta, run);

			run = [];
		};

		for (const operation of operations) {
			if (run.length > 0 && operation.meta !== runMeta) recordRun();

			runMeta = operation.meta;

			run.push(operation);
		}

		recordRun();
	});

	return history;
}
