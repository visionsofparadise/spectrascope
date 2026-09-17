export interface GestureKey {
	readonly current: () => string;
	readonly end: () => void;
}

export function createGestureKey(): GestureKey {
	let key: string | undefined;

	return {
		current: () => {
			key ??= crypto.randomUUID();

			return key;
		},
		end: () => {
			key = undefined;
		},
	};
}
