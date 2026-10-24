export interface SkeletonProps {
  /** Height in px. Width fills the container. */
  height?: number;
  /** Accessible label describing what is loading. */
  label?: string;
}

/**
 * A neutral loading block (no shimmer gradient). The region is marked
 * aria-busy so assistive tech announces the pending state (ui-design.md).
 */
export default function Skeleton({ height = 20, label }: SkeletonProps) {
  return (
    <span
      role="status"
      aria-busy="true"
      aria-label={label ?? "Loading"}
      className="block w-full rounded-[12px] bg-line"
      style={{ height }}
    />
  );
}
