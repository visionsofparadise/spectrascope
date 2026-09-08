import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "./Button";

interface Props {
	readonly title: string;
	readonly onClose: () => void;
	readonly children: ReactNode;
}

export function Dialog({ title, onClose, children }: Props) {
	const ref = useRef<HTMLDialogElement>(null);
	const titleId = useId();

	useEffect(() => {
		const dialog = ref.current;

		dialog?.showModal();

		return () => dialog?.close();
	}, []);

	return (
		<dialog
			ref={ref}
			aria-labelledby={titleId}
			onCancel={(event) => {
				event.preventDefault();
				onClose();
			}}
			className="m-auto max-h-[85vh] w-[min(560px,calc(100vw-32px))] overflow-y-auto border border-chrome-border bg-void p-6 font-body text-chrome-text shadow-2xl backdrop:bg-black/70"
		>
			<div className="mb-5 flex items-center justify-between gap-4">
				<h2 id={titleId} className="font-display text-xl uppercase tracking-wider">
					{title}
				</h2>
				<Button variant="ghost" onClick={onClose} aria-label={`Close ${title}`}>
					Close
				</Button>
			</div>
			{children}
		</dialog>
	);
}
