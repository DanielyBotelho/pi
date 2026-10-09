import { type ThemeColor, theme } from "../theme/theme.ts";

/**
 * A braille-art cat mascot shown in the startup header instead of the tiny built-in "Pi" glyph.
 * Pure unicode braille patterns, so it renders the same everywhere (no half-block/background tricks).
 */
const CAT_ART_LINES: readonly string[] = [
	"⠀⠀⠀⠀⠀⠀⠀⢀⣠⣶⣿⣿⣿⣿⣿⣿⣿⣶⣤⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⣠⣾⣿⣿⣿⣿⣿⣿⡿⠛⠉⠉⠛⢿⣿⣷⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⠀⢀⣾⣿⣿⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠻⣿⣧⠀⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⢀⣿⣿⡿⠟⠛⠛⠻⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠘⢿⣧⠀⠀⠀⠀⠀⠀⠀",
	"⠀⠀⣼⣿⡟⠀⠀⠀⠀⠀⠈⢻⣿⣇⠀⠀⣴⣷⡄⠀⠀⠀⠘⣿⡆⠀⠀⣀⣤⣤⣄",
	"⠀⠀⣿⣿⠁⠀⠀⠀⠀⠀⠀⠈⣿⠿⢷⡀⠘⠛⠃⠀⠀⠀⠀⣿⣅⣴⡿⠟⠋⢹⣿",
	"⠀⠀⢻⣿⡀⠀⠀⠀⢾⣿⡆⠀⢿⣤⣴⡇⠀⠀⠀⠸⠘⠀⢠⡟⠋⠁⠀⠀⠀⢸⡟",
	"⠀⠀⠈⢿⣇⠀⠀⠀⠈⠉⠁⠀⠀⠉⠉⠀⠀⠀⠀⠀⠀⢀⡾⠁⠀⠀⠀⠀⠀⣼⡟",
	"⠀⠀⠀⠈⢿⣦⡀⠀⠃⠃⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⠸⠁⠀⠀⠀⠀⠀⢰⣿⠃",
	"⠀⠀⠀⠀⠀⣹⣿⣶⣤⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠄⠁⠀⠐⢧⠀⠀⢀⣾⡟⠀⠀",
	"⠀⠀⠀⢠⣾⠟⠉⠀⠀⠉⠉⠀⠐⠂⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢿⣶⡿⠋⠀⠀⠀",
	"⣠⣶⡾⠋⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⡇⠀⠀⠀⠀",
	"⢻⣧⣄⠀⠀⠀⢰⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⠀⠀⠀⠀",
	"⠀⠉⠛⠿⣷⣶⣾⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣤⣤⣾⣿⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⢹⣿⣿⣿⣿⣷⣦⡀⠀⢀⣀⠀⠀⠀⣠⣴⣿⣿⣿⣿⣷⠀⠀⠀⠀",
	"⠀⠀⠀⠀⠀⠀⠀⠻⢿⣿⣿⣿⣿⠿⠿⠛⠉⠻⠿⠿⠿⣿⣿⣿⠿⠟⠁⠀⠀⠀⠀",
];

export const CAT_ART_ROWS = CAT_ART_LINES.length;
export const CAT_ART_COLUMNS = CAT_ART_LINES[0]?.length ?? 0;

/** Colors the shimmer cycles through, top to bottom. Theme roles, not fixed hues, so it follows any theme. */
const SHIMMER_ROLES: readonly ThemeColor[] = ["accent", "bashMode", "success", "warning"];

/**
 * Renders the cat with a soft color shimmer that flows down its body. `tick` advances on a timer so each
 * frame shifts which band of rows gets which color, same art, no animation on the glyphs themselves.
 */
export function renderCatArt(tick: number): string[] {
	const bandSize = Math.max(1, Math.ceil(CAT_ART_ROWS / SHIMMER_ROLES.length));
	return CAT_ART_LINES.map((line, row) => {
		const role = SHIMMER_ROLES[(Math.floor(row / bandSize) + tick) % SHIMMER_ROLES.length] ?? "text";
		return theme.fg(role, line);
	});
}
