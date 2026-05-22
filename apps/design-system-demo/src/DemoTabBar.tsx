import { IconButton, DropdownButton, type MenuItem } from "@spectrascope/design-system";

interface Props {
	readonly tabs: ReadonlyArray<{ id: string; label: string }>;
	readonly activeTabId: string;
	readonly menuItems?: ReadonlyArray<MenuItem>;
}

export function DemoTabBar({ tabs, activeTabId, menuItems }: Props) {
	return (
		<div className="flex h-12 shrink-0 items-center gap-2 bg-void px-3">
			{menuItems && menuItems.length > 0 && (
				<DropdownButton
					trigger={<IconButton icon="lucide:menu" label="Menu" size={20} />}
					items={menuItems}
				/>
			)}

			<div className="h-6 w-px bg-chrome-border-subtle" />

			{tabs.map((tab) => {
				const isActive = tab.id === activeTabId;

				return (
					<div
						key={tab.id}
						className={`flex items-center gap-2 ${
							isActive ? "bg-primary text-void" : "bg-chrome-raised text-chrome-text"
						}`}
					>
						<span className="font-body text-[length:var(--text-base)]">{tab.label}</span>
						<IconButton icon="lucide:x" label="Close tab" size={14} dim />
					</div>
				);
			})}

			<IconButton
				icon="lucide:plus"
				label="New tab"
				size={20}
				active={!tabs.some((tab) => tab.id === activeTabId)}
				activeVariant="primary"
			/>
		</div>
	);
}
