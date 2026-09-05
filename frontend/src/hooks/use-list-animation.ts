import { useAutoAnimate } from "@formkit/auto-animate/react";

/**
 * App-wide default for animating list/table containers when items are
 * added, removed, filtered, or reordered — instead of content just
 * snapping in and out. One shared config here so the motion feels
 * consistent everywhere it's used, rather than each call site picking
 * its own duration/easing.
 *
 * Usage: `const [parentRef] = useListAnimation(); <div ref={parentRef}>...</div>`
 * The parent element's direct children animate; it doesn't touch anything
 * that already manages its own transitions (e.g. Radix Accordion/Dialog).
 */
export function useListAnimation<T extends Element = HTMLDivElement>() {
  return useAutoAnimate<T>({
    duration: 200,
    easing: "ease-in-out",
  });
}
