import { type ThemeColor, theme } from "../theme/theme.ts";

/**
 * A braille-art penguin mascot shown in the startup header instead of the tiny built-in "Pi" glyph.
 * Pure unicode braille patterns, so it renders the same everywhere (no half-block/background tricks).
 */
const PENGUIN_ART_LINES: readonly string[] = [
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

const BLANK_BRAILLE = "⠀";

export const PENGUIN_ART_ROWS = PENGUIN_ART_LINES.length;
export const PENGUIN_ART_COLUMNS = PENGUIN_ART_LINES[0]?.length ?? 0;

/** Colors the body shimmer cycles through, top to bottom. Theme roles, not fixed hues, so it follows any theme. */
const SHIMMER_ROLES: readonly ThemeColor[] = ["accent", "bashMode", "success", "warning"];

/** Colors sparkles cycle through. Kept to warm/bright roles so glitter reads distinctly from body shimmer. */
const SPARKLE_ROLES: readonly ThemeColor[] = ["accent", "warning", "bashMode"];

const SPARKLE_GLYPHS: readonly string[] = ["✦", "✧", "⋆", "✶"];

/** Fraction of blank cells sparkling on any given frame. */
const SPARKLE_DENSITY = 0.045;

/** Deterministic pseudo-random float in [0, 1) from three integers, so a given frame always looks the same. */
function hash3(a: number, b: number, c: number): number {
	let h = a * 374761393 + b * 668265263 + c * 2246822519;
	h = (h ^ (h >>> 13)) * 1274126177;
	h = h ^ (h >>> 16);
	return ((h >>> 0) % 10_000) / 10_000;
}

function pickSparkle(row: number, col: number, tick: number): { glyph: string; role: ThemeColor } | undefined {
	if (hash3(row, col, tick) >= SPARKLE_DENSITY) return undefined;
	const glyph = SPARKLE_GLYPHS[Math.floor(hash3(row, col, tick + 101) * SPARKLE_GLYPHS.length)] ?? "✦";
	const role = SPARKLE_ROLES[Math.floor(hash3(row, col, tick + 202) * SPARKLE_ROLES.length)] ?? "accent";
	return { glyph, role };
}

/**
 * Renders the penguin with a soft color shimmer flowing down its body, plus a scatter of glitter sparkles
 * twinkling in the blank space around it. `tick` advances on a timer, shifting the shimmer bands and
 * which cells sparkle each frame. The art itself never changes, only the coloring.
 */
export function renderPenguinArt(tick: number): string[] {
	const bandSize = Math.max(1, Math.ceil(PENGUIN_ART_ROWS / SHIMMER_ROLES.length));
	return PENGUIN_ART_LINES.map((line, row) => {
		const bodyRole = SHIMMER_ROLES[(Math.floor(row / bandSize) + tick) % SHIMMER_ROLES.length] ?? "text";
		let rendered = "";
		for (let col = 0; col < line.length; col++) {
			const char = line[col];
			if (char !== BLANK_BRAILLE) {
				rendered += theme.fg(bodyRole, char ?? "");
				continue;
			}
			const sparkle = pickSparkle(row, col, tick);
			rendered += sparkle ? theme.fg(sparkle.role, sparkle.glyph) : char;
		}
		return rendered;
	});
}
