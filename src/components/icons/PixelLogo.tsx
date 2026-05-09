'use client';

import { SVGProps } from 'react';

/** Pixel-art zkCoins logo — orange "z" inside a rounded square. */
export function PixelLogo({ size = 32, ...rest }: { size?: number } & SVGProps<SVGSVGElement>) {
  // 12×12 pixel grid — '#' is filled.
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
      {...rest}
    >
      {cells.map(({ x, y }, i) => (
        <rect key={i} x={x} y={y} width="1" height="1" fill="#ffffff" />
      ))}
    </svg>
  );
}
