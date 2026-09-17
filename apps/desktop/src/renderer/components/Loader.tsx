import { useQuery } from "@tanstack/react-query";
import { main } from "../models/Main";
import { loadAppState } from "../models/State/App";
import { AppLayout } from "./Layout";
import type { Logger } from "../../shared/models/Logger";
import type { QueryClient } from "@tanstack/react-query";

interface Props {
	readonly queryClient: QueryClient;
	readonly logger: Logger;
}

export function AppLoader({ queryClient, logger }: Props) {
	const { data: initialState } = useQuery({
		queryKey: ["initialState"],
		queryFn: () => loadAppState(main),
	});

	const { data: userDataPath } = useQuery({
		queryKey: ["userDataPath"],
		queryFn: () => main.getUserDataPath(),
	});

	if (!initialState || !userDataPath) {
		return (
			<div className="flex h-screen items-center justify-center bg-chrome-base">
				<div className="text-chrome-text-secondary font-technical uppercase tracking-[0.06em]">Loading...</div>
			</div>
		);
	}

	return (
		<AppLayout initialState={initialState} userDataPath={userDataPath} queryClient={queryClient} logger={logger} />
	);
}
