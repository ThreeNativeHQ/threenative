export type IconName =
  | "arrowRight"
  | "bolt"
  | "chevronDown"
  | "close"
  | "copy"
  | "cube"
  | "devices"
  | "external"
  | "hexagon"
  | "menu"
  | "puzzle"
  | "search"
  | "terminal";

export interface IIconProps {
  readonly name: IconName;
  readonly className?: string;
  readonly strokeWidth?: number;
}

const PATHS: Record<IconName, string> = {
  arrowRight: "M4 12h15m0 0-5.5-5.5M19 12l-5.5 5.5",
  bolt: "M13.5 2.5 4.5 13.8h6.2l-1.2 7.7 9-11.3h-6.2z",
  chevronDown: "m6 9.5 6 5.5 6-5.5",
  close: "m6 6 12 12M18 6 6 18",
  copy: "M9 9V5.6c0-.6.5-1.1 1.1-1.1h8.3c.6 0 1.1.5 1.1 1.1v8.3c0 .6-.5 1.1-1.1 1.1H15M5.6 9h8.3c.6 0 1.1.5 1.1 1.1v8.3c0 .6-.5 1.1-1.1 1.1H5.6a1.1 1.1 0 0 1-1.1-1.1v-8.3c0-.6.5-1.1 1.1-1.1Z",
  cube: "M12 2.6 21 7.6v9l-9 5-9-5v-9zM12 12.6 21 7.6M12 12.6 3 7.6M12 12.6v9",
  devices: "M3 5.5h12.5v9H3zM6.5 18.5h6M9.5 14.5v4M18 8.5h3.2v10H18z",
  external:
    "M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4.4c0 .6-.5 1.1-1.1 1.1H5.6a1.1 1.1 0 0 1-1.1-1.1V8.1c0-.6.5-1.1 1.1-1.1H10",
  hexagon: "M12 2.6 21 7.6v9l-9 5-9-5v-9zM12 2.6v19M3 7.6l18 9M21 7.6l-18 9",
  menu: "M4 7h16M4 12h16M4 17h16",
  puzzle:
    "M10.2 3.5h3.6v2a1.7 1.7 0 1 0 3.4 0v-2h3.3v3.4h-2a1.7 1.7 0 1 0 0 3.4h2v3.4h-3.3v-2a1.7 1.7 0 1 0-3.4 0v2h-3.6v-3.3h-2a1.7 1.7 0 1 1 0-3.4h2z",
  search: "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM20 20l-4.4-4.4",
  terminal: "M5 7.5 9.5 12 5 16.5M12.5 16.5H19",
};

/** One stroked SVG set, sized by the caller. Every mark in the reference is a 24-unit outline. */
export function Icon({ name, className, strokeWidth = 1.6 }: IIconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      focusable="false"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
