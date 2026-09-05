import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { cn } from "../cn";
import type { ComponentPropsWithoutRef } from "react";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
	className,
	sideOffset = 4,
	collisionPadding = 8,
	...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				sideOffset={sideOffset}
				collisionPadding={collisionPadding}
				className={cn(
					"z-50 flex flex-col gap-2 bg-chrome-raised py-2 shadow-[0_8px_24px_rgba(0,0,0,0.5)] outline-none",
					className,
				)}
				{...props}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

export function DropdownMenuItem({ className, ...props }: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>) {
	return (
		<DropdownMenuPrimitive.Item
			className={cn(
				"mx-2 flex cursor-pointer items-center gap-2 py-1 text-left font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text outline-none data-[highlighted]:bg-interactive-hover data-[disabled]:cursor-default data-[disabled]:opacity-30",
				className,
			)}
			{...props}
		/>
	);
}

export function DropdownMenuSeparator({
	className,
	...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
	return (
		<DropdownMenuPrimitive.Separator className={cn("mx-2 my-1 h-px bg-chrome-border-subtle", className)} {...props} />
	);
}
