interface WindowBounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface FileChangedPayload {
	path: string;
	contentHash: string;
}

export interface MainEventMap {
	windowBoundsChanged: [windowBounds: WindowBounds];
	"file:changed": [payload: FileChangedPayload];
}
