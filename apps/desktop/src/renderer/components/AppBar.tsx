import { Icon } from "@iconify/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "./DropdownMenu";
import { IconButton } from "./IconButton";
import { LoadingToast } from "./LoadingToast";
import type { AppContext } from "../models/Context";
import type { HistoryControl } from "../state/useComparisonHistory";

interface Props {
	readonly context: AppContext;
	readonly historyControl: HistoryControl | null;
	readonly canExport: boolean;
	readonly exportBusy: boolean;
	readonly onExport: () => void;
	readonly onPreferences: () => void;
}

const DRAG = { WebkitAppRegion: "drag" } as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function AppBar({ context, historyControl, canExport, exportBusy, onExport, onPreferences }: Props) {
	const { app, appStore } = context;

	const [editingTabId, setEditingTabId] = useState<string | null>(null);
	const [editingName, setEditingName] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const hasActiveTab = app.activeTabId !== null;

	const tabs = app.tabs.map((tab) => ({
		id: tab.id,
		label: app.comparisons.find((entry) => entry.id === tab.comparisonId)?.name ?? "Session",
	}));

	const selectTab = (id: string): void => {
		appStore.mutate(app, (proxy) => {
			proxy.activeTabId = id;
		});
	};

	const closeTab = useCallback(
		(id: string): void => {
			void context.closeComparison(id);
		},
		[context],
	);

	const closeActiveTab = useCallback((): void => {
		if (app.activeTabId !== null) {
			closeTab(app.activeTabId);
		}
	}, [app.activeTabId, closeTab]);

	const startEditing = useCallback((tabId: string, currentLabel: string) => {
		setEditingTabId(tabId);
		setEditingName(currentLabel);
	}, []);

	const commitRename = useCallback(() => {
		if (editingTabId && editingName.trim()) {
			context.renameTab(editingTabId, editingName.trim());
		}

		setEditingTabId(null);
		setEditingName("");
	}, [editingTabId, editingName, context]);

	const cancelEditing = useCallback(() => {
		setEditingTabId(null);
		setEditingName("");
	}, []);

	useEffect(() => {
		if (editingTabId && inputRef.current) {
			inputRef.current.focus();
			inputRef.current.select();
		}
	}, [editingTabId]);

	return (
		<div className="flex h-12 shrink-0 items-center gap-2 bg-void pl-3 pr-[138px]" style={DRAG}>
			<div className="relative shrink-0" style={NO_DRAG}>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<IconButton icon="lucide:menu" label="Menu" size={20} />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="w-[200px]">
						<DropdownMenuItem onSelect={() => void context.newComparison()}>New Session</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => void context.openComparison()}>Open Session…</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							disabled={!hasActiveTab || context.busy}
							onSelect={() => void context.saveComparison()}
						>
							Save Session
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={!hasActiveTab || context.busy}
							onSelect={() => void context.saveComparison(true)}
						>
							Save Session As…
						</DropdownMenuItem>
						<DropdownMenuItem disabled={!canExport} onSelect={onExport}>
							Export…
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem onSelect={onPreferences}>Preferences</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem disabled={!hasActiveTab} onSelect={closeActiveTab}>
							Close Session
						</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => window.close()}>Close</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<div className="h-6 w-px shrink-0 bg-chrome-border-subtle" />

			<div className="relative isolate flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 -z-10 flex items-center overflow-hidden"
				>
					<span className="select-none whitespace-nowrap pl-1 font-display text-sm tracking-[0.5em] text-chrome-text-dim opacity-[0.08]">
						SPECTRASCOPE
					</span>
				</div>
				{tabs.map((tab) => {
					const isActive = tab.id === (app.activeTabId ?? "");
					const isEditing = editingTabId === tab.id;

					return (
						<div
							key={tab.id}
							style={NO_DRAG}
							className={`flex shrink-0 cursor-pointer items-center gap-1.5 ${
								isActive ? "bg-primary text-void" : "bg-chrome-raised text-chrome-text"
							}`}
							onClick={() => selectTab(tab.id)}
							onKeyDown={(event) => {
								if (event.key === "Enter" || event.key === " ") {
									event.preventDefault();
									selectTab(tab.id);
								}
							}}
							role="tab"
							aria-selected={isActive}
							tabIndex={0}
						>
							{isEditing ? (
								<input
									ref={inputRef}
									type="text"
									value={editingName}
									onChange={(event) => setEditingName(event.target.value)}
									onBlur={commitRename}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											commitRename();
										} else if (event.key === "Escape") {
											cancelEditing();
										}

										event.stopPropagation();
									}}
									onClick={(event) => event.stopPropagation()}
									className="w-32 bg-transparent font-body text-base text-inherit outline-none"
								/>
							) : (
								<span
									className="font-body text-base whitespace-nowrap"
									onDoubleClick={(event) => {
										event.stopPropagation();
										startEditing(tab.id, tab.label);
									}}
								>
									{tab.label}
								</span>
							)}
							<button
								type="button"
								aria-label="Close tab"
								onClick={(event) => {
									event.stopPropagation();
									closeTab(tab.id);
								}}
								className={`flex items-center ${isActive ? "text-void" : "text-chrome-text-dim"}`}
							>
								<Icon icon="lucide:x" width={16} height={16} />
							</button>
						</div>
					);
				})}

				<div className="shrink-0" style={NO_DRAG}>
					<IconButton
						icon="lucide:plus"
						label="Home"
						size={20}
						active={app.activeTabId === null}
						activeVariant="primary"
						onClick={() =>
							appStore.mutate(app, (proxy) => {
								proxy.activeTabId = null;
							})
						}
					/>
				</div>
			</div>

			{exportBusy && <LoadingToast label="Exporting…" className="shrink-0" />}

			{hasActiveTab && (
				<div className="flex shrink-0 items-center gap-1.5" style={NO_DRAG}>
					<div className="h-6 w-px shrink-0 bg-chrome-border-subtle" />
					<IconButton
						icon="lucide:undo-2"
						label="Undo"
						size={16}
						variant="ghost"
						disabled={!historyControl?.canUndo}
						onClick={() => historyControl?.undo()}
					/>
					<IconButton
						icon="lucide:redo-2"
						label="Redo"
						size={16}
						variant="ghost"
						disabled={!historyControl?.canRedo}
						onClick={() => historyControl?.redo()}
					/>
				</div>
			)}
		</div>
	);
}
