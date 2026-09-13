import { Icon } from "@iconify/react";
import { useEffect, useState } from "react";
import { Button } from "../Button";
import { TerrainShader } from "../TerrainShader";
import { lastOpenedLabelOf } from "./utils/lastOpenedLabel";
import type { AppContext } from "../../models/Context";

interface Props {
	readonly context: AppContext;
}

const LABEL_REFRESH_MS = 60_000;

export function HomeScreen({ context }: Props) {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		const interval = setInterval(() => setNow(Date.now()), LABEL_REFRESH_MS);

		return () => clearInterval(interval);
	}, []);

	return (
		<div className="relative flex flex-1 flex-col overflow-hidden bg-void">
			<TerrainShader theme={context.app.theme} className="absolute inset-0" />
			<div className="relative flex h-full flex-col p-4">
				<h1 className="-mt-[0.16em] font-display text-[6rem] font-bold leading-none -tracking-[0.02em] text-chrome-text">
					SPECTRASCOPE
				</h1>

				<div className="flex-1" />
				<div className="flex flex-col gap-6">
					{context.app.recentSessions.length > 0 && (
						<section className="flex flex-col gap-4">
							<h2 className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.1em] text-chrome-text-dim">
								Recent Sessions
							</h2>
							<div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
								{context.app.recentSessions.map((session) => (
									<div key={session.filePath} className="flex min-w-0 items-baseline gap-2">
										<button
											type="button"
											disabled={context.busy}
											onClick={() => void context.openComparison(session.filePath)}
											className="flex w-fit min-w-0 items-baseline gap-5 text-left hover:bg-secondary"
											title={session.filePath}
										>
											<span className="shrink-0 font-body text-base text-chrome-text">{session.name}</span>
											<span className="min-w-0 truncate font-technical text-[length:var(--text-xs)] text-chrome-text-dim">
												{session.filePath}
											</span>
											<span className="shrink-0 font-technical text-[length:var(--text-xs)] text-chrome-text-dim">
												{lastOpenedLabelOf(session.lastOpenedAt, now)}
											</span>
										</button>
										<button
											type="button"
											aria-label={`Remove ${session.name} from recent sessions`}
											onClick={() => context.removeRecentSession(session.filePath)}
											className="shrink-0 text-chrome-text-dim"
										>
											×
										</button>
									</div>
								))}
							</div>
						</section>
					)}

					<div className="flex flex-col items-start gap-2">
						<Button variant="primary" onClick={() => void context.newComparison()}>
							<Icon icon="lucide:plus" width={16} height={16} aria-hidden="true" />
							New Session
						</Button>
						<Button variant="secondary" onClick={() => void context.openComparison()}>
							<Icon icon="lucide:folder-open" width={16} height={16} aria-hidden="true" />
							Open Session
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
