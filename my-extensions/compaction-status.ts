import { calculateCost } from '@earendil-works/pi-ai';
import { SettingsManager } from '@earendil-works/pi-coding-agent';

const tokenFormat = new Intl.NumberFormat('en-US', {
  notation: 'compact', maximumFractionDigits: 1,
});
const formatTokens = (tokens) => tokenFormat.format(tokens).toLowerCase();

function cachedInputStatus(model, tokens) {
  if (tokens == null || !model.cost) return '$Min/req: ?';

  const cost = calculateCost(model, {
    input: 0, output: 0, cacheRead: tokens, cacheWrite: 0, cost: {},
  }).cacheRead;
  // Catalog zero rates can mean unavailable pricing, not free requests.
  const unknownZero = cost === 0 && (tokens !== 0 || model.cost.cacheRead <= 0);
  if (!Number.isFinite(cost) || cost < 0 || unknownZero) return '$Min/req: ?';

  const price = cost > 0 && cost < 0.001 ? '<0.001' : cost.toFixed(3);
  return `$Min/req: ${price}`;
}

/** @param {import("@earendil-works/pi-coding-agent").ExtensionAPI} pi */
export default function compactionStatus(pi) {
  const update = (_event, ctx) => {
    if (ctx.mode !== 'tui') return;
    if (!ctx.model) {
      ctx.ui.setStatus('compaction', undefined);
      ctx.ui.setStatus('context-cost', undefined);
      return;
    }

    const tokens = ctx.getContextUsage()?.tokens;
    ctx.ui.setStatus('context-cost', ctx.ui.theme.fg('dim', cachedInputStatus(ctx.model, tokens)));
    const setStatus = (text) => ctx.ui.setStatus('compaction', ctx.ui.theme.fg('dim', text));

    // Reuse Pi's defaults, overrides and validation without settings file I/O.
    const settings = SettingsManager.inMemory({ compaction: pi.getSettings().compaction });
    if (!settings.getCompactionEnabled()) {
      setStatus('Compaction: auto off');
      return;
    }

    let reserveTokens;
    try {
      reserveTokens = settings.getCompactionReserveTokens(ctx.model);
    } catch {
      setStatus('Compaction: invalid settings');
      return;
    }

    const threshold = ctx.model.contextWindow - reserveTokens;
    if (threshold <= 0) {
      setStatus('Compaction: no headroom');
      return;
    }

    const used = tokens == null ? '?' : formatTokens(tokens);
    const percent = tokens == null ? '' : ` (${Math.round((tokens / threshold) * 100)}%)`;
    setStatus(`Context: ${used}/${formatTokens(threshold)}${percent}`);
  };

  for (const event of [
    'session_start', 'model_select', 'session_tree', 'session_compact',
    'input', 'message_end', 'turn_start', 'turn_end', 'agent_settled',
  ]) {
    pi.on(event, update);
  }
}
