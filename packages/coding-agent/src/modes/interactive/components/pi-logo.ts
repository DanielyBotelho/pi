import { backgroundAnsi, foregroundAnsi, isAppleTerminalSession, rgbColor } from "@earendil-works/pi-tui";
import { theme } from "../theme/theme.ts";

const GOLD = rgbColor(255, 179, 71);
const TEAL = rgbColor(47, 110, 94);
const AQUA = rgbColor(94, 230, 196);
const RESET = "\x1b[0m";

/**
 * The pi logo: 4 cells wide and 2 lines tall. Each cell shows two square pixels with half blocks:
 *
 *   gold gold gold .
 *   teal .    gold .
 *   teal teal .    aqua
 *   teal .    .    aqua
 *
 * The brand colors stay fixed across themes; they follow the terminal's color mode.
 */
export function piLogoLines(): [string, string] {
	const mode = theme.getColorMode();
	const fg = (color: typeof GOLD) => foregroundAnsi(color, mode);
	// The fourth cell of the top line is empty, so it is padded to the same width as the bottom line.
	const top = `${fg(GOLD)}${backgroundAnsi(TEAL, mode)}▀${RESET}${fg(GOLD)}▀█${RESET} `;
	const bottom = `${fg(TEAL)}█▀${RESET} ${fg(AQUA)}█${RESET}`;
	return [top, bottom];
}

/**
 * Whether the terminal renders the half-block logo correctly. Apple Terminal draws gaps between rows and
 * misaligns the half blocks, so it gets the text wordmark instead.
 */
export function supportsPiLogo(): boolean {
	return !isAppleTerminalSession();
}

/** Text fallback for the logo: "Pi" with the logo's gold and aqua. */
export function piWordmark(): string {
	const mode = theme.getColorMode();
	return `${foregroundAnsi(GOLD, mode)}P${RESET}${foregroundAnsi(AQUA, mode)}i${RESET}`;
}
