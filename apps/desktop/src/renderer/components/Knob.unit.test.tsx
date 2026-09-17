import { batch, flush } from "opshot";
import { isValidElement } from "react";
import { expect, it, vi } from "vitest";
import { createSession } from "../models/State/Session";
import { createSavedSession } from "../session/createSavedSession";
import { createGestureKey } from "../utils/gestureKey";
import { Knob } from "./Knob";
import type { ReactElement } from "react";

const hooks = vi.hoisted(() => ({
	stateIndex: 0,
	states: new Array<unknown>(),
	refIndex: 0,
	refs: new Array<{ current: unknown }>(),
}));

vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useCallback: (callback: unknown) => callback,
	useRef: (initial: unknown) => {
		const index = hooks.refIndex++;
		const held = hooks.refs[index] ?? { current: initial };

		hooks.refs[index] = held;

		return held;
	},
	useState: (initial: unknown) => {
		const index = hooks.stateIndex++;

		if (!(index in hooks.states)) hooks.states[index] = initial;

		return [
			hooks.states[index],
			(next: unknown) => {
				hooks.states[index] = next;
			},
		];
	},
}));

function surfaceOf(props: Parameters<typeof Knob>[0]): ReactElement<Record<string, unknown>> {
	hooks.stateIndex = 0;
	hooks.refIndex = 0;

	const knob = Knob(props) as ReactElement<{ readonly children: ReadonlyArray<unknown> }>;

	return knob.props.children.find(
		(child): child is ReactElement<Record<string, unknown>> => isValidElement(child) && child.type === "svg",
	)!;
}

it("ends the gesture when the drag loses its pointer capture", () => {
	const session = createSession(createSavedSession([]));
	const { document } = session;
	const gestureKey = createGestureKey();
	const render = () =>
		surfaceOf({
			value: document.renderSettings.gridOpacity,
			label: "",
			size: 24,
			hideValue: true,
			onChange: (value: number) => {
				batch(() => {
					document.renderSettings.gridOpacity = value;
				}, gestureKey.current());
				flush(document);
			},
			onChangeEnd: gestureKey.end,
		});
	const grab = (surface: ReactElement<Record<string, unknown>>) =>
		(surface.props.onPointerDown as (event: unknown) => void)({
			clientY: 100,
			pointerId: 1,
			target: { setPointerCapture: vi.fn() },
		});
	const turn = (surface: ReactElement<Record<string, unknown>>, clientY: number) =>
		(surface.props.onPointerMove as (event: unknown) => void)({ clientY });

	grab(render());

	const first = render();

	turn(first, 85);
	turn(first, 70);
	expect(session.history.length).toBe(1);
	(first.props.onLostPointerCapture as () => void)();
	grab(render());

	const second = render();

	turn(second, 55);
	expect(session.history.length).toBe(2);
	expect(document.renderSettings.gridOpacity).toBeCloseTo(0.8);
});
