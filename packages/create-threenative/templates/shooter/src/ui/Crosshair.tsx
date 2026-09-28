import type { ComponentType, ReactNode } from "react";

export type CrosshairPart = "root" | "vertical" | "horizontal";

export interface ICrosshairPrimitiveProps {
	readonly children?: ReactNode;
	readonly hidden: boolean;
	readonly hitFlash: number;
	readonly part: CrosshairPart;
}

export interface ICrosshairProps {
	readonly aiming: boolean;
	readonly hitFlash: number;
	readonly Primitive: ComponentType<ICrosshairPrimitiveProps>;
}

/**
 * The gameplay crosshair shared by the DOM and CanvasLayer React renderers.
 *
 * The component owns when the reticle exists and its two-bar structure. Each renderer supplies
 * only the platform primitive that paints a root or bar, because DOM classes cannot execute on the
 * native host and CanvasLayer styles are not CSS.
 */
export function Crosshair({ aiming, hitFlash, Primitive }: ICrosshairProps) {
	return (
		<Primitive hidden={aiming} hitFlash={hitFlash} part="root">
			<Primitive hidden={aiming} hitFlash={hitFlash} part="vertical" />
			<Primitive hidden={aiming} hitFlash={hitFlash} part="horizontal" />
		</Primitive>
	);
}
