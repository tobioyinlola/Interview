type P = { className?: string };
const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
const make = (d: string) =>
  function Icon({ className = "h-5 w-5" }: P) {
    return (
      <svg {...base} className={className}>
        <path d={d} />
      </svg>
    );
  };

export const HomeIcon = make("M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10");
export const NoteIcon = make("M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7");
export const BuildingIcon = make(
  "M4 21V5l8-2v18M12 9h8v12M7 8h2M7 12h2M7 16h2M15 13h2M15 17h2M3 21h18",
);
export const MicIcon = make(
  "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM6 11a6 6 0 0 0 12 0M12 17v4",
);
export const ListIcon = make(
  "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
);
export const GearIcon = make(
  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
);
export const ChartIcon = make("M4 20V10M10 20V4M16 20v-7M22 20H2");
export const ShieldIcon = make("M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z");
export const FileIcon = make("M6 3h9l4 4v14H6zM14 3v5h5");
export const LogoutIcon = make("M15 17l5-5-5-5M20 12H9M9 21H4V3h5");
export const MenuIcon = make("M4 6h16M4 12h16M4 18h16");
export const CloseIcon = make("M6 6l12 12M18 6L6 18");
export const PlusIcon = make("M12 5v14M5 12h14");
export const ArrowIcon = make("M7 17L17 7M8 7h9v9");
export const ClockIcon = make(
  "M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z",
);
export const CheckIcon = make("M5 12l5 5L20 7");
export const EyeIcon = make(
  "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
);
export const EyeOffIcon = make(
  "M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.2A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.2-.9",
);

export function ChevronIcon({
  className = "h-5 w-5",
  direction = "left",
}: P & { direction?: "left" | "right" }) {
  return (
    <svg {...base} className={className}>
      <path d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

export const GiftIcon = make(
  "M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z",
);

export const HelpIcon = make(
  "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01",
);

export const CompassIcon = make(
  "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15.5 8.5l-2 5-5 2 2-5z",
);

export const UsersIcon = make(
  "M16 20v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7M21 20v-1a4 4 0 00-3-3.9M16 4.1a3.5 3.5 0 010 6.8",
);
export const ActivityIcon = make("M3 12h4l3-8 4 16 3-8h4");
export const MailIcon = make("M3 6h18v12H3zM3 7l9 7 9-7");
export const TargetIcon = make(
  "M12 21a9 9 0 100-18 9 9 0 000 18M12 16a4 4 0 100-8 4 4 0 000 8M12 12h.01",
);
export const GaugeIcon = make("M4 16a8 8 0 1116 0M12 16l4-5M8 20h8");
export const CoinIcon = make(
  "M12 21a9 9 0 100-18 9 9 0 000 18M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.7-2.5 1.8 0 2.4 5 1.2 5 3.6 0 1.1-1.1 1.8-2.5 1.8-1.1 0-2-.5-2.5-1.5M12 6.5V8M12 16v1.5",
);

export const SendIcon = make("M22 2L11 13M22 2l-7 20-4-9-9-4z");

export const RocketIcon = make(
  "M5 15c-1 1-1.5 4-1.5 4s3-.5 4-1.5M12 15l-3-3a22 22 0 0 1 2-4 11 11 0 0 1 9-5c0 3-1.5 7-5 9a22 22 0 0 1-4 2zM9 12H5l2-3 3-.5M12 15v4l3-2 .5-3",
);
