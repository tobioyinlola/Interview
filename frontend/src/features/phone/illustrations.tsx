/** Three small illustrations for the first-run welcome, drawn in the brand colours. They are SVG, so
 *  they stay sharp on any screen, and the floating bits stop moving for people who ask for less motion. */

const SOFT = "#EFE8FF";
const ACCENT = "#7B47F3";
const INK = "#1C1B2E";

function Frame({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <svg
      viewBox="0 0 320 260"
      role="img"
      aria-label={label}
      className="mx-auto h-auto w-full max-w-[320px]"
    >
      <circle cx="160" cy="130" r="112" fill={SOFT} />
      <circle cx="60" cy="48" r="9" fill={ACCENT} opacity="0.18" />
      <circle cx="268" cy="214" r="13" fill={ACCENT} opacity="0.14" />
      {children}
    </svg>
  );
}

/** Slide 1: a researched brief about a company. */
export function CompanyArt() {
  return (
    <Frame label="A company brief with a source behind every fact">
      <g className="wl-float">
        <rect x="70" y="52" width="180" height="156" rx="22" fill="#fff" />
        <circle cx="106" cy="88" r="20" fill={ACCENT} />
        <path
          d="M98 96V80h10v16m0-10h6v10M101 84h4m-4 5h4"
          stroke="#fff"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="136" y="76" width="78" height="9" rx="4.5" fill={INK} />
        <rect x="136" y="92" width="52" height="7" rx="3.5" fill="#C9C4DD" />
        <rect x="88" y="120" width="144" height="8" rx="4" fill="#E4E0F2" />
        <rect x="88" y="136" width="120" height="8" rx="4" fill="#E4E0F2" />
        <rect x="88" y="152" width="136" height="8" rx="4" fill="#E4E0F2" />
        <rect x="88" y="172" width="64" height="22" rx="11" fill={SOFT} />
        <path
          d="M100 183h8m-4-4v8"
          stroke={ACCENT}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect
          x="114"
          y="180"
          width="30"
          height="6"
          rx="3"
          fill={ACCENT}
          opacity="0.55"
        />
      </g>
      <g className="wl-float wl-delay">
        <rect x="196" y="150" width="92" height="40" rx="14" fill={INK} />
        <circle cx="216" cy="170" r="9" fill="#34D399" />
        <path
          d="M211.5 170l3.2 3.2 5.8-6"
          stroke="#fff"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect
          x="232"
          y="162"
          width="44"
          height="6"
          rx="3"
          fill="#fff"
          opacity="0.9"
        />
        <rect
          x="232"
          y="174"
          width="30"
          height="5"
          rx="2.5"
          fill="#fff"
          opacity="0.5"
        />
      </g>
    </Frame>
  );
}

/** Slide 2: Auto-Apply, a fan of applications going out. */
export function ApplyArt() {
  const card = (y: number, tone: string, w: number, rot: number) => (
    <g transform={`rotate(${rot} 160 130)`}>
      <rect x="82" y={y} width="156" height="54" rx="16" fill="#fff" />
      <circle cx="110" cy={y + 27} r="14" fill={tone} />
      <rect x="132" y={y + 15} width={w} height="8" rx="4" fill={INK} />
      <rect x="132" y={y + 31} width="52" height="6" rx="3" fill="#C9C4DD" />
      <circle cx="218" cy={y + 27} r="9" fill="#34D399" />
      <path
        d={`M213.8 ${y + 27}l3 3 5.4-5.6`}
        stroke="#fff"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
  return (
    <Frame label="Applications going out one after another">
      {card(150, "#F59E0B", 60, -5)}
      {card(104, "#38BDF8", 74, 2)}
      <g className="wl-float">{card(58, ACCENT, 68, -1)}</g>
      <g className="wl-float wl-delay">
        <circle cx="258" cy="70" r="30" fill={INK} />
        <path
          d="M262 52c-9 3-15 10-17 19l-5 3 4 4-2 5 6-1 3 4 3-5c8-1 14-7 17-18-2-1-5-3-9-11zM264 64a3.5 3.5 0 1 1-.01 0z"
          fill="#fff"
        />
        <circle
          cx="258"
          cy="70"
          r="30"
          fill="none"
          stroke={ACCENT}
          strokeWidth="2.5"
          strokeDasharray="120 70"
          strokeLinecap="round"
        />
      </g>
    </Frame>
  );
}

/** Slide 3: an interview invite, and being prepared for it. */
export function InterviewArt() {
  return (
    <Frame label="An interview invitation and the answers to prepare">
      <g className="wl-float">
        <rect x="76" y="46" width="168" height="96" rx="22" fill="#fff" />
        <rect x="94" y="64" width="34" height="34" rx="11" fill={SOFT} />
        <rect x="94" y="64" width="34" height="11" rx="5.5" fill={ACCENT} />
        <text
          x="111"
          y="91"
          textAnchor="middle"
          fontSize="15"
          fontWeight="700"
          fill={INK}
          fontFamily="Inter, system-ui, sans-serif"
        >
          14
        </text>
        <rect x="140" y="66" width="82" height="9" rx="4.5" fill={INK} />
        <rect x="140" y="82" width="56" height="7" rx="3.5" fill="#C9C4DD" />
        <rect x="94" y="110" width="128" height="20" rx="10" fill={ACCENT} />
        <rect x="132" y="117" width="52" height="6" rx="3" fill="#fff" />
      </g>
      <g className="wl-float wl-delay">
        <path
          d="M110 160a16 16 0 0 1 16-16h96a16 16 0 0 1 16 16v32a16 16 0 0 1-16 16h-58l-22 18v-18h-16a16 16 0 0 1-16-16z"
          fill={INK}
        />
        <g fill="#fff">
          <rect x="146" y="164" width="9" height="22" rx="4.5" />
          <rect x="162" y="158" width="9" height="34" rx="4.5" />
          <rect x="178" y="168" width="9" height="14" rx="4.5" />
          <rect x="194" y="162" width="9" height="26" rx="4.5" />
        </g>
      </g>
    </Frame>
  );
}
