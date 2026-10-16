import { useMixerStore } from "../../store/mixer";
import type { OutputPriority } from "../../types";
import { relativeTime } from "../../lib/format";
import { IconButton } from "../IconButton";
import { Ms } from "../Icons";

export interface PriorityRow {
  name: string;
  description: string;
  connected: boolean;
  /** Unix seconds; null for a ranked device Sink has no memory of. */
  lastSeen: number | null;
}

/** `order` with the entry at `index` moved by `delta`, clamped to the ends. */
export function moveRank(order: string[], index: number, delta: number): string[] {
  const to = Math.max(0, Math.min(order.length - 1, index + delta));
  if (index < 0 || index >= order.length || to === index) return order;
  const next = [...order];
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * The ranked devices in order, then every other remembered device -
 * connected ones first, the rest most recently seen first.
 */
export function priorityRows(
  priority: OutputPriority,
  live: ReadonlyMap<string, string>,
): { ranked: PriorityRow[]; others: PriorityRow[] } {
  const known = new Map(priority.known.map((k) => [k.name, k]));
  const row = (name: string): PriorityRow => ({
    name,
    description: live.get(name) || known.get(name)?.description || name,
    connected: live.has(name),
    lastSeen: known.get(name)?.last_seen ?? null,
  });
  const ranked = priority.order.map(row);
  const rankedNames = new Set(priority.order);
  // Live devices count even before their first sighting is saved.
  const otherNames = new Set(
    [...priority.known.map((k) => k.name), ...live.keys()].filter((n) => !rankedNames.has(n)),
  );
  const others = [...otherNames]
    .map(row)
    .sort(
      (a, b) =>
        Number(b.connected) - Number(a.connected) ||
        (b.lastSeen ?? 0) - (a.lastSeen ?? 0) ||
        a.description.localeCompare(b.description),
    );
  return { ranked, others };
}

function Status({ row }: Readonly<{ row: PriorityRow }>) {
  if (row.connected) return <span className="tag live">connected</span>;
  return null;
}

function subline(row: PriorityRow): string {
  if (row.connected) return row.name;
  return row.lastSeen === null ? "not seen yet" : `last seen ${relativeTime(row.lastSeen)}`;
}

export function OutputPrioritySection() {
  const priority = useMixerStore((s) => s.outputPriority);
  const outputDevices = useMixerStore((s) => s.outputDevices);
  const setOutputPriority = useMixerStore((s) => s.setOutputPriority);
  const forgetOutputDevice = useMixerStore((s) => s.forgetOutputDevice);

  const live = new Map(outputDevices.map((d) => [d.name, d.description]));
  const { ranked, others } = priorityRows(priority, live);
  const order = priority.order;
  // The ends are no-ops; don't round-trip an unchanged list.
  const rerank = (index: number, delta: number) => {
    const next = moveRank(order, index, delta);
    if (next !== order) void setOutputPriority(next);
  };

  return (
    <>
      <div className="section-label">Output priority</div>
      <div className="card" style={{ padding: "var(--sp-2)" }}>
        <div className="row">
          <div className="ricon">
            <Ms name="format_list_numbered" />
          </div>
          <div className="rmain">
            <div className="rtitle">Device ranking</div>
            <div className="rsub">
              Channels set to “Priority list” play on the highest connected device, and switch back
              when a higher one reconnects
            </div>
          </div>
        </div>
        {ranked.length === 0 && (
          <div className="row row-compact">
            <Ms name="arrow_downward" className="row-compact-icon" />
            <div className="rmain">
              <div className="rsub">Nothing ranked yet - add devices from the list below</div>
            </div>
          </div>
        )}
        {ranked.map((row, i) => (
          <div className="row row-compact" key={row.name}>
            <span className="row-compact-icon priority-rank">{i + 1}</span>
            <div className="rmain">
              <div className="rtitle" title={row.name}>
                <span className="rname">{row.description}</span>
              </div>
              <div className="rsub">{subline(row)}</div>
            </div>
            <div className="rtrail">
              <Status row={row} />
              <IconButton
                boxed
                icon="keyboard_arrow_up"
                title="Move up"
                label={`Move ${row.description} up`}
                onClick={() => rerank(i, -1)}
              />
              <IconButton
                boxed
                icon="keyboard_arrow_down"
                title="Move down"
                label={`Move ${row.description} down`}
                onClick={() => rerank(i, 1)}
              />
              <IconButton
                boxed
                icon="remove"
                title="Remove from the ranking"
                label={`Remove ${row.description} from the ranking`}
                onClick={() => void setOutputPriority(order.filter((n) => n !== row.name))}
              />
            </div>
          </div>
        ))}
        {others.length > 0 && <div className="row-divider">Other devices</div>}
        {others.map((row) => (
          <div className="row row-compact" key={row.name}>
            <Ms name="speaker" className="row-compact-icon" />
            <div className="rmain">
              <div className="rtitle" title={row.name}>
                <span className="rname">{row.description}</span>
              </div>
              <div className="rsub">{subline(row)}</div>
            </div>
            <div className="rtrail">
              <Status row={row} />
              {!row.connected && (
                <IconButton
                  reveal
                  danger
                  icon="delete"
                  title="Forget this device"
                  label={`Forget ${row.description}`}
                  onClick={() => void forgetOutputDevice(row.name)}
                />
              )}
              <IconButton
                boxed
                icon="add"
                title="Add to the ranking"
                label={`Add ${row.description} to the ranking`}
                onClick={() => void setOutputPriority([...order, row.name])}
              />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
