import { useReportViewProgress } from "./viewProgress";

export function ComputeProgress({ fraction }: { readonly fraction: number }) {
	useReportViewProgress(fraction);

	return null;
}
