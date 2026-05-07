import { SVGProps } from 'react';

/**
 * zkCoins official logo — pixel-art "Z" inside a rounded capsule. Same shape
 * used at hero size on the welcome screen and at small size in headers.
 *
 * Renders as a 12x12 pixel grid; each filled cell is a 1×1 SVG rect.
 */
export function Logo({ size = 28, ...props }: { size?: number } & SVGProps<SVGSVGElement>) {
  // 12-cell-wide × 12-row map — '#' is filled, ' ' is empty.
  const map = [
    '            ',
    '   ######   ',
    '   #    #   ',
    '  ########  ',
    '  ##    ##  ',
    '  ##  ####  ',
    '  ####  ##  ',
    '  ##    ##  ',
    '  ########  ',
    '   #    #   ',
    '   ######   ',
    '            ',
  ];

  const W = map[0].length;
  const H = map.length;
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (map[y][x] === '#') cells.push({ x, y });
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${W} ${H}`}
      shapeRendering="crispEdges"
      className="pixel-edges"
      role="img"
      aria-label="zkCoins"
      {...props}
    >
      {cells.map(({ x, y }, i) => (
        <rect key={i} x={x} y={y} width="1" height="1" fill="#ffffff" />
      ))}
    </svg>
  );
}
