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
import type { AppContext } from "../models/Context";
import type { HistoryControl } from "../state/useComparisonHistory";

interface Props {
	readonly context: AppContext;
	/**
	 * The active comparison's undo/redo control, published up from `ComparisonTab`.
	 * `null` on Home (no active comparison) — both buttons render disabled.
	 */
	readonly historyControl: HistoryControl | null;
}

const DRAG = { WebkitAppRegion: "drag" } as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

/**
 * AppBar — the single 48px chrome bar replacing the old `TitleBar` + `TabBar`
 * pair (mockup lines 50–86). Hamburger app menu, divider, session tabs with a
 * trailing `+` (opens Home), then right-aligned undo / redo driven by the
 * active comparison's published history control. The bar is the OS drag region
 * on `bg-void`; interactive children opt out with `no-drag`, and the right
 * padding reserves the native `titleBarOverlay` window-control footprint.
 */
export function AppBar({ context, historyControl }: Props) {
	const { app, appStore } = context;

	const [editingTabId, setEditingTabId] = useState<string | null>(null);
	const [editingName, setEditingName] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const hasActiveTab = app.activeTabId !== null;

	const tabs = app.tabs.map((tab) => ({
		id: tab.id,
		label: context.tabNames.get(tab.id) ?? "Comparison",
	}));

	const selectTab = (id: string): void => {
		appStore.mutate(app, (proxy) => {
			proxy.activeTabId = id;
		});
	};

	const closeTab = useCallback(
		(id: string): void => {
			appStore.mutate(app, (proxy) => {
				const index = proxy.tabs.findIndex((tab) => tab.id === id);

				if (index === -1) return;

				proxy.tabs.splice(index, 1);

				if (proxy.activeTabId === id) {
					proxy.activeTabId = proxy.tabs[index]?.id ?? proxy.tabs[index - 1]?.id ?? null;
				}
			});

			context.tabNames.delete(id);
			context.renameCallbacks.delete(id);
		},
		[app, appStore, context.tabNames, context.renameCallbacks],
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
			{/* App menu */}
			<div className="relative shrink-0" style={NO_DRAG}>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<IconButton icon="lucide:menu" label="Menu" size={20} />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="w-[200px]">
						<DropdownMenuItem onSelect={() => void context.newComparison()}>New Session</DropdownMenuItem>
						<DropdownMenuItem onSelect={() => void context.openComparison()}>Open…</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem disabled>Save</DropdownMenuItem>
						<DropdownMenuItem disabled>Save As…</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem disabled>Export…</DropdownMenuItem>
						<DropdownMenuItem disabled={!hasActiveTab} onSelect={closeActiveTab}>
							Close Session
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem disabled>Preferences</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<div className="h-6 w-px shrink-0 bg-chrome-border-subtle" />

			{/* Session tabs + new-tab. The row background is the OS drag region
			    (inherited from the bar); each interactive child opts back out with
			    no-drag. A faint wordmark sits behind the chips. */}
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
							className={`flex shrink-0 cursor-pointer items-center gap-1.5 pl-2 pr-1 ${
								isActive ? "bg-primary text-void" : "bg-chrome-raised text-chrome-text"
							}`}
							onClick={() => selectTab(tab.id)}
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
								className={`flex items-center px-0.5 py-1 ${isActive ? "text-void" : "text-chrome-text-dim"}`}
							>
								<Icon icon="lucide:x" width={14} height={14} />
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

			{/* Undo / redo */}
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
		</div>
	);
}
