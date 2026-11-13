// Small monochrome tool icons in the spirit of the original 1-bit palette.
import type { ToolId } from "../state/useToolStore";

const S = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "square" as const };

export function ToolIcon({ id }: { id: ToolId }) {
  const body = (() => {
    switch (id) {
      case "select":
        return <path d="M5 3 L5 16 L8.5 12.5 L11 18 L13 17 L10.5 11.5 L15 11.5 Z" fill="currentColor" stroke="none" />;
      case "line":
        return <path d="M3 17 L17 3" {...S} />;
      case "doubleLine":
        return <path d="M2 14 L14 2 M6 18 L18 6" {...S} />;
      case "rect":
        return <rect x="3" y="5" width="14" height="10" {...S} />;
      case "circle":
        return <circle cx="10" cy="10" r="7" {...S} />;
      case "arc":
        return <path d="M3 16 A 10 10 0 0 1 16 4" {...S} />;
      case "ellipse":
        return <ellipse cx="10" cy="10" rx="8" ry="5" {...S} />;
      case "polygon":
        return <path d="M10 2.5 L16.5 6.25 L16.5 13.75 L10 17.5 L3.5 13.75 L3.5 6.25 Z" {...S} />;
      case "spline":
        return <path d="M2 14 C 6 2, 10 18, 18 5" {...S} />;
      case "guide":
        return <path d="M1 10 L19 10 M10 1 L10 19" {...S} strokeDasharray="2 2" strokeWidth={1} />;
      case "wall":
        return (
          <g>
            <path d="M3 17 L3 3 L17 3 M7 17 L7 7 L17 7" {...S} />
            <path d="M3 3 L7 7" {...S} strokeWidth={1} />
          </g>
        );
      case "dimension":
        return (
          <g>
            <path d="M3 6 L3 16 M17 6 L17 16 M3 12 L17 12" {...S} strokeWidth={1} />
            <path d="M3 12 L6 10.5 L6 13.5 Z M17 12 L14 10.5 L14 13.5 Z" fill="currentColor" stroke="none" />
          </g>
        );
      case "trim":
        return (
          <g>
            <path d="M10 2 L10 18" {...S} />
            <path d="M2 10 L10 10" {...S} />
            <path d="M10 10 L18 10" {...S} strokeDasharray="2 2" strokeWidth={1} />
          </g>
        );
      case "extend":
        return (
          <g>
            <path d="M17 2 L17 18" {...S} />
            <path d="M2 10 L9 10" {...S} />
            <path d="M9 10 L16 10" {...S} strokeDasharray="2 2" strokeWidth={1} />
          </g>
        );
      case "split":
        return (
          <g>
            <path d="M2 10 L8 10 M12 10 L18 10" {...S} />
            <path d="M10 5 L10 15" {...S} strokeWidth={1} />
          </g>
        );
      case "offset":
        return <path d="M3 14 C 7 6, 13 6, 17 14 M3 18 C 7 10, 13 10, 17 18" {...S} />;
      case "fillet":
        return <path d="M4 18 L4 10 A 6 6 0 0 1 10 4 L18 4" {...S} />;
      case "chamfer":
        return <path d="M4 18 L4 10 L10 4 L18 4" {...S} />;
      case "text":
        return (
          <text x="10" y="16" textAnchor="middle" fontSize="15" fontFamily="Georgia, serif" fill="currentColor">
            A
          </text>
        );
      case "symbol":
        return (
          <g>
            <rect x="3" y="3" width="14" height="14" {...S} strokeWidth={1} strokeDasharray="2 2" />
            <path d="M6 14 L6 6 M6 14 A 8 8 0 0 0 14 6" {...S} />
          </g>
        );
    }
  })();
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      {body}
    </svg>
  );
}
