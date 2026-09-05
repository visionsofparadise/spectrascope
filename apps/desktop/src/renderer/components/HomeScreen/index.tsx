import { Icon } from "@iconify/react";
import { TerrainShader } from "../TerrainShader";
import type { AppContext } from "../../models/Context";

interface Props {
	readonly context: AppContext;
}

export function HomeScreen({ context }: Props) {
	return (
		<div className="relative flex flex-1 flex-col overflow-hidden bg-void">
			<TerrainShader className="absolute inset-0" />
			<div className="relative flex h-full flex-col p-4">
				<h1 className="-mt-[0.16em] font-display text-[6rem] font-bold leading-none -tracking-[0.02em] text-chrome-text">
					SPECTRASCOPE
				</h1>

				<div className="flex-1" />

				<div className="flex flex-col gap-2">
					<button
						type="button"
						onClick={() => void context.newComparison()}
						className="flex w-fit items-center gap-2 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-void transition-colors hover:brightness-110"
					>
						<span className="flex items-center gap-2 bg-primary px-2 py-1">
							<Icon icon="lucide:plus" width={16} />
							New Session
						</span>
					</button>
					<button
						type="button"
						onClick={() => void context.openComparison()}
						className="flex w-fit items-center gap-2 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text transition-colors hover:brightness-125"
					>
						<span className="flex items-center gap-2 bg-secondary px-2 py-1">
							<Icon icon="lucide:folder-open" width={16} />
							Open Session
						</span>
					</button>
				</div>
			</div>
		</div>
	);
}
