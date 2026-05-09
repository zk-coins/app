'use client';

import { SVGProps } from 'react';

/**
 * Pixel-art icons rendered as SVG with each "pixel" being a 1×1 rect.
 * Designed on a 12×12 grid, scaled up via the size prop.
 *
 * Each map is a string array where '#' is a filled pixel and ' ' is empty.
 */

type IconProps = { size?: number; className?: string } & SVGProps<SVGSVGElement>;

const LOGO = [
  '            ',
  '   ######   ',
  '   #    #   ',
  '   #    #   ',
  '   ######   ',
  '   ##  ##   ',
  '   ##  ##   ',
  '   ##  ##   ',
  '  ###  ###  ',
  '            ',
  '            ',
  '            ',
];

const SEND = [
  '            ',
  '######      ',
  '#         # ',
  '#       ##  ',
  '#      ##   ',
  '#     ##    ',
  '######      ',
  '            ',
  '            ',
  '            ',
  '            ',
  '            ',
];

const RECEIVE = [
  '            ',
  '   ##       ',
  '  ####      ',
  ' ######     ',
  '   ##       ',
  '   ##  ##   ',
  '   ##  ##   ',
  '   ##  ##   ',
  '   ##  ##   ',
  '   ######   ',
  '            ',
  '            ',
];

const WALLET = [
  '            ',
  ' #########  ',
  ' #       #  ',
  ' #       #  ',
  ' #     ###  ',
  ' #    ##    ',
  ' #     ###  ',
  ' #       #  ',
  ' #########  ',
  '            ',
  '            ',
  '            ',
];

const APPS = [
  '            ',
  ' ###  ###   ',
  ' ###  ###   ',
  ' ###  ###   ',
  '            ',
  ' ###  ###   ',
  ' ###  ###   ',
  ' ###  ###   ',
  '            ',
  '            ',
  '            ',
  '            ',
];

const SETTINGS = [
  '            ',
  '    ####    ',
  '   ##  ##   ',
  ' ##      ## ',
  ' #   ##   # ',
  ' #  ####  # ',
  ' #  ####  # ',
  ' #   ##   # ',
  ' ##      ## ',
  '   ##  ##   ',
  '    ####    ',
  '            ',
];

const EYE = [
  '            ',
  '            ',
  '   #####    ',
  '  #     #   ',
  ' #  ###  #  ',
  ' # ##### #  ',
  ' #  ###  #  ',
  '  #     #   ',
  '   #####    ',
  '            ',
  '            ',
  '            ',
];

const EYE_OFF = [
  '            ',
  ' #          ',
  '  ######    ',
  '  #     #   ',
  ' #  ###  #  ',
  ' # ##### #  ',
  ' #  ###  #  ',
  '  #     #   ',
  '   #####    ',
  '          # ',
  '            ',
  '            ',
];

const COPY = [
  '            ',
  '  #####     ',
  '  #   #     ',
  '  # #####   ',
  '  # #   #   ',
  '  ### #  #  ',
  '    #    #  ',
  '    #    #  ',
  '    ######  ',
  '            ',
  '            ',
  '            ',
];

const CHECK = [
  '            ',
  '            ',
  '          # ',
  '         ## ',
  '        ##  ',
  ' #     ##   ',
  ' ##   ##    ',
  '  ## ##     ',
  '   ###      ',
  '            ',
  '            ',
  '            ',
];

const LIST = [
  '            ',
  '   #  ####  ',
  '  ###       ',
  '   #        ',
  '            ',
  '   #  ####  ',
  '  ###       ',
  '   #        ',
  '            ',
  '   #  ####  ',
  '  ###       ',
  '   #        ',
];

const ARROW_LEFT = [
  '            ',
  '            ',
  '   #        ',
  '  ##        ',
  ' ##         ',
  '##########  ',
  '##########  ',
  ' ##         ',
  '  ##        ',
  '   #        ',
  '            ',
  '            ',
];

const KEY = [
  '            ',
  '   ####     ',
  '  ##  ##    ',
  '  ##  ## #  ',
  '  ##  ###   ',
  '   ####     ',
  '    ##      ',
  '    ##      ',
  '    ###     ',
  '    ##      ',
  '    ##      ',
  '            ',
];

const SHIELD = [
  '            ',
  '   #####    ',
  '  ##   ##   ',
  '  ##   ##   ',
  '  ## # ##   ',
  '  #####     ',
  '  ##   ##   ',
  '  ##   ##   ',
  '   ##  ##   ',
  '    ####    ',
  '     ##     ',
  '            ',
];

const PLUS = [
  '            ',
  '            ',
  '            ',
  '    ####    ',
  '    ####    ',
  ' ##########  ',
  ' ##########  ',
  '    ####    ',
  '    ####    ',
  '            ',
  '            ',
  '            ',
];

const ZAP = [
  '            ',
  '       ##   ',
  '      ##    ',
  '     ##     ',
  '    ###     ',
  '   #####    ',
  '     ##     ',
  '    ##      ',
  '   ##       ',
  '  ##        ',
  '            ',
  '            ',
];

const GLOBE = [
  '            ',
  '   #####    ',
  '  #     #   ',
  ' #   #   #  ',
  ' ##  #  ##  ',
  ' #########  ',
  ' ##  #  ##  ',
  ' #   #   #  ',
  '  #     #   ',
  '   #####    ',
  '            ',
  '            ',
];

const SHIELD_CHECK = [
  '            ',
  '   #####    ',
  '  ##   ##   ',
  '  ##    ##  ',
  '  ##  # ##  ',
  '  ## ## ##  ',
  '  #####  #  ',
  '  ## #   ## ',
  '   ##   ##  ',
  '    ## ##   ',
  '     ###    ',
  '            ',
];

const GHOST = [
  '            ',
  '    ####    ',
  '   ######   ',
  '  ## ## ##  ',
  '  ## ## ##  ',
  '  ########  ',
  '  ########  ',
  '  ########  ',
  '  ########  ',
  '  ## ## ##  ',
  '  #  #  #   ',
  '            ',
];

const LOCK = [
  '            ',
  '   ####     ',
  '  ##  ##    ',
  '  ##  ##    ',
  '  ##  ##    ',
  ' ########   ',
  ' ##  ## #   ',
  ' ##  ####   ',
  ' ##    ##   ',
  ' ########   ',
  '            ',
  '            ',
];

const HOME = [
  '            ',
  '     ##     ',
  '    ####    ',
  '   ######   ',
  '  ########  ',
  ' ########## ',
  '  ########  ',
  '  ##  # ##  ',
  '  ##  # ##  ',
  '  ##  # ##  ',
  '  ########  ',
  '            ',
];

const X_ICON = [
  '            ',
  '            ',
  '  ##    ##  ',
  '   ##  ##   ',
  '    ####    ',
  '     ##     ',
  '    ####    ',
  '   ##  ##   ',
  '  ##    ##  ',
  '            ',
  '            ',
  '            ',
];

const MAP = {
  logo: LOGO,
  send: SEND,
  receive: RECEIVE,
  wallet: WALLET,
  apps: APPS,
  settings: SETTINGS,
  eye: EYE,
  'eye-off': EYE_OFF,
  copy: COPY,
  check: CHECK,
  list: LIST,
  'arrow-left': ARROW_LEFT,
  key: KEY,
  shield: SHIELD,
  plus: PLUS,
  zap: ZAP,
  globe: GLOBE,
  'shield-check': SHIELD_CHECK,
  ghost: GHOST,
  lock: LOCK,
  home: HOME,
  x: X_ICON,
} as const;

export type PixelName = keyof typeof MAP;

export function PixelIcon({
  name,
  size = 16,
  color = 'currentColor',
  className,
  ...rest
}: IconProps & { name: PixelName; color?: string }) {
  const map = MAP[name];
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
      className={`pixel-edges ${className ?? ''}`}
      shapeRendering="crispEdges"
      {...rest}
    >
      {cells.map(({ x, y }, i) => (
        <rect key={i} x={x} y={y} width="1" height="1" fill={color} />
      ))}
    </svg>
  );
}
