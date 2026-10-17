import type { SVGProps } from "react";

/**
 * Hey Traders brand mark — circular logo featuring the green bull, candlestick chart, and typography.
 * Rendered as an SVG embedding /logo.png so it satisfies SVGProps<SVGSVGElement> cleanly across all components.
 */
export function BrandGlyph({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      className={className}
      {...props}
    >
      <image href="/logo.png" x="0" y="0" width="100" height="100" />
    </svg>
  );
}
