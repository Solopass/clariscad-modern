// Slim strip of every shortcut, built from the same list the keys use.
import { panelShortcuts, SECTIONS, chordLabel } from "../input/keymap";

const mac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

function Keycap({ text }: { text: string }) {
  return (
    <kbd className="mr-1 inline-block min-w-[1.1em] rounded-[3px] border border-black bg-[#f7f7f7] px-[3px] text-center font-mono text-[10px] leading-[14px] shadow-[0_1px_0_#000]">
      {text}
    </kbd>
  );
}

export function ShortcutBar({ onClose }: { onClose(): void }) {
  const all = panelShortcuts();
  return (
    <div className="flex h-[78px] shrink-0 items-stretch gap-3 overflow-x-auto border-t border-black bg-white px-2 py-1" aria-label="Keyboard shortcuts">
      {SECTIONS.map((section) => {
        const items = all.filter((s) => s.section === section);
        if (!items.length) return null;
        return (
          <section key={section} className="shrink-0 border-r border-[#ddd] pr-3">
            <div className="flex items-baseline gap-2">
              <b className="text-[10px] tracking-wide uppercase">{section}</b>
            </div>
            <div className="grid grid-flow-col grid-rows-3 gap-x-3">
              {items.map((s) => (
                <div key={s.id} className="flex items-center whitespace-nowrap text-[11px]" title={s.remap}>
                  <Keycap text={chordLabel(s.chord, mac)} />
                  <span>{s.label}</span>
                </div>
              ))}
            </div>
          </section>
        );
      })}
      <button className="mac-btn sticky right-0 self-start bg-white" onClick={onClose} title="Hide shortcuts">
        Hide
      </button>
    </div>
  );
}
