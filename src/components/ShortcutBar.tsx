// Slim strip of every shortcut, built from the same list the keys use.
import { panelShortcuts, SECTIONS, chordLabel } from "../input/keymap";

const mac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

function Keycap({ text }: { text: string }) {
  return (
    <kbd className="mr-0.5 inline-block min-w-[1em] rounded-[2px] border border-black bg-[#f7f7f7] px-[2px] text-center font-mono text-[9px] leading-[12px] shadow-[0_1px_0_#000]">
      {text}
    </kbd>
  );
}

export function ShortcutBar({ onClose }: { onClose(): void }) {
  const all = panelShortcuts();
  return (
    <div data-shortcut-bar className="flex shrink-0 flex-wrap content-start items-center gap-x-1.5 gap-y-0 overflow-x-hidden border-t border-black bg-white px-1.5 py-0.5" aria-label="Keyboard shortcuts">
      {SECTIONS.map((section) => {
        const items = all.filter((s) => s.section === section);
        if (!items.length) return null;
        return (
          <div key={section} className="contents">
            <b className="text-[9px] tracking-wide uppercase text-[#555]">{section}</b>
            {items.map((s) => (
              <span key={s.id} className="inline-flex items-center whitespace-nowrap text-[10px] leading-[16px]" title={s.remap}>
                <Keycap text={chordLabel(s.chord, mac)} />
                <span className="mr-0.5">{s.label}</span>
              </span>
            ))}
          </div>
        );
      })}
      <button className="mac-btn" onClick={onClose} title="Hide shortcuts">
        Hide
      </button>
    </div>
  );
}
