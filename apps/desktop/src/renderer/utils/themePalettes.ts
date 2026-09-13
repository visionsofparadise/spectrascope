export type ThemeId = "lava" | "viridis";

export interface ThemePalette {
	readonly accent: string;
	readonly tint: string;
	readonly ramp: ReadonlyArray<string>;
	readonly sky: string;
}

export const THEME_PALETTES: Readonly<Record<ThemeId, ThemePalette>> = {
	lava: {
		accent: "#F09B19",
		tint: "#0F1446",
		ramp: [
			"#000000",
			"#05051E",
			"#0F1446",
			"#1E0F32",
			"#500A05",
			"#8C1400",
			"#B93700",
			"#D76405",
			"#F09B19",
			"#FCD246",
			"#FFF08C",
			"#FFFFFF",
		],
		sky: "#05051E",
	},
	viridis: {
		accent: "#FDE725",
		tint: "#21918C",
		ramp: [
			"#440154",
			"#482878",
			"#3E4A89",
			"#31688E",
			"#26828E",
			"#1F9E89",
			"#35B779",
			"#6DCD59",
			"#B4DE2C",
			"#FDE725",
		],
		sky: "#1B1A45",
	},
};
