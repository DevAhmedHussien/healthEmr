'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

/** Gap between the trigger and the bubble, and the margin kept from the edge. */
const OFFSET = 6;
const EDGE = 8;

interface Placement {
  top: number;
  left: number;
}

/**
 * A tooltip for content a cell had to cut short.
 *
 * Rows are one line, so anything long is truncated — and a truncated address or
 * set of directions is no use if there is no way to read the rest. Shows on
 * hover *and* on focus, because a keyboard user has no hover, and carries
 * `role="tooltip"` with `aria-describedby` so a screen reader gets the full text
 * rather than the ellipsis.
 *
 * Rendered through a portal, positioned from the trigger's own rectangle. The
 * previous version was absolutely positioned inside the trigger, which put it
 * inside the table cell — and `.ar-table tbody td` sets `overflow: hidden` to
 * keep rows one line tall. A clipping ancestor beats any z-index, so all that
 * ever appeared was the sliver of the bubble that fell inside the cell.
 */
export function Tooltip({
  content,
  children,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
}) {
  const trigger = React.useRef<HTMLSpanElement>(null);
  const bubble = React.useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = React.useState<DOMRect | null>(null);
  const [placement, setPlacement] = React.useState<Placement | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const id = React.useId();

  // A portal needs a DOM to aim at, and the server has none.
  React.useEffect(() => setMounted(true), []);

  const show = () => setAnchor(trigger.current?.getBoundingClientRect() ?? null);
  const hide = React.useCallback(() => {
    setAnchor(null);
    setPlacement(null);
  }, []);

  // Positioned after the bubble exists, because where it goes depends on how big
  // it turned out to be: above unless that would leave the viewport, and never
  // past either edge.
  React.useLayoutEffect(() => {
    if (!anchor || !bubble.current) return;

    const box = bubble.current.getBoundingClientRect();
    const fitsAbove = anchor.top - box.height - OFFSET >= EDGE;

    setPlacement({
      top: fitsAbove ? anchor.top - box.height - OFFSET : anchor.bottom + OFFSET,
      left: Math.min(
        Math.max(EDGE, anchor.left),
        Math.max(EDGE, window.innerWidth - box.width - EDGE),
      ),
    });
  }, [anchor]);

  // Closed on scroll rather than followed. A fixed bubble left behind by a
  // scrolling table points at the wrong row, which is worse than no tooltip.
  React.useEffect(() => {
    if (!anchor) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [anchor, hide]);

  if (!content) return <>{children}</>;

  return (
    <>
      <span
        ref={trigger}
        className="relative inline-flex min-w-0 max-w-full"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        tabIndex={0}
        aria-describedby={anchor ? id : undefined}
      >
        <span className="truncate">{children}</span>
      </span>

      {anchor && mounted
        ? createPortal(
            <span
              ref={bubble}
              id={id}
              role="tooltip"
              className="pointer-events-none fixed z-[60] w-max max-w-[24rem] whitespace-normal break-words rounded-[var(--ar-radius)] bg-[var(--ar-headings)] px-2.5 py-1.5 text-left text-[0.78rem] font-normal leading-snug text-white shadow-[0_4px_14px_rgba(34,48,62,0.3)]"
              style={
                placement
                  ? { top: placement.top, left: placement.left }
                  : // The first paint is the measurement. Showing it at the
                    // anchor for that frame would make every tooltip flicker.
                    { top: anchor.top, left: anchor.left, visibility: 'hidden' }
              }
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
