import { createContext, useContext } from "react";
import type { ColormapTheme } from "@spectrascope/design-system";

export interface ThemeContextValue {
	readonly colormap: ColormapTheme;
	readonly setColormap: (theme: ColormapTheme) => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
	colormap: "lava",
	setColormap: () => {},
});

export function useColormapTheme(): ThemeContextValue {
	return useContext(ThemeContext);
}
