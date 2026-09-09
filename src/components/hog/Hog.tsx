import { useId } from "react";
import type { HogAppearance } from "./appearance";

type HogProps = {
  appearance: HogAppearance;
  className?: string;
};

const BODY_SIZE = {
  small: { rx: 90, ry: 72 },
  round: { rx: 105, ry: 80 },
  huge: { rx: 124, ry: 91 },
  lean: { rx: 72, ry: 82 },
} as const;

export function Hog({ appearance, className }: HogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const gradientId = useId().replaceAll(":", "");
  const { rx, ry } = BODY_SIZE[appearance.body];
  const bodyClass = `hog-body hog-body-${appearance.variant}`;

  return (
    <svg
      className={["hog", className].filter(Boolean).join(" ")}
      viewBox="0 0 360 280"
      role="img"
      aria-labelledby={`${titleId} ${descriptionId}`}
      data-hog-variant={appearance.variant}
    >
      <title id={titleId}>{appearance.name}</title>
      <desc id={descriptionId}>{appearance.description}</desc>
      <defs>
        <radialGradient id={gradientId} cx="38%" cy="28%" r="75%">
          <stop offset="0" stopColor="#ffc9dc" />
          <stop offset="1" stopColor="#e887ad" />
        </radialGradient>
      </defs>

      <ellipse className="hog-shadow" cx="180" cy="250" rx={rx * 0.8} ry="13" />
      <Effects kind={appearance.effect} />
      <Tail />
      <BackAttachment kind={appearance.back} />
      <Legs body={appearance.body} />

      <ellipse className={bodyClass} cx="180" cy="156" rx={rx} ry={ry} fill={`url(#${gradientId})`} />
      <Ears body={appearance.body} />
      <Outfit kind={appearance.outfit} rx={rx} />
      <Face eyes={appearance.eyes} mouth={appearance.mouth} />
    </svg>
  );
}

function Tail() {
  return <path className="hog-line hog-tail" d="M278 144c28-19 33 15 14 17-14 2-15-18-3-20" />;
}

function Ears({ body }: { body: HogAppearance["body"] }) {
  const spread = body === "lean" ? 48 : 62;
  return (
    <g className="hog-ears">
      <path d={`M${180 - spread} 99 Q${142 - spread} 34 ${173 - spread} 51 L${188 - spread} 100Z`} />
      <path d={`M${180 + spread} 99 Q${218 + spread} 34 ${187 + spread} 51 L${172 + spread} 100Z`} />
      <path className="hog-ear-inner" d={`M${177 - spread} 84 Q${153 - spread} 49 ${174 - spread} 61Z`} />
      <path className="hog-ear-inner" d={`M${183 + spread} 84 Q${207 + spread} 49 ${186 + spread} 61Z`} />
    </g>
  );
}

function Legs({ body }: { body: HogAppearance["body"] }) {
  const left = body === "lean" ? 154 : 136;
  const right = body === "lean" ? 206 : 224;
  return (
    <g className="hog-legs">
      <path d={`M${left} 205v39q0 13-14 13h-14`} />
      <path d={`M${right} 205v39q0 13 14 13h14`} />
    </g>
  );
}

function Face({ eyes, mouth }: { eyes: HogAppearance["eyes"]; mouth: HogAppearance["mouth"] }) {
  return (
    <g className="hog-face">
      <Eyes kind={eyes} />
      <ellipse className="hog-snout" cx="180" cy="169" rx="43" ry="32" />
      <ellipse className="hog-nostril" cx="164" cy="164" rx="5" ry="8" />
      <ellipse className="hog-nostril" cx="196" cy="164" rx="5" ry="8" />
      <Mouth kind={mouth} />
    </g>
  );
}

function Eyes({ kind }: { kind: HogAppearance["eyes"] }) {
  if (kind === "wet") return (
    <g className="hog-eyes hog-eyes-wet">
      {[137, 223].map(x => <g key={x}><ellipse cx={x} cy="125" rx="27" ry="33" /><circle cx={x} cy="131" r="13" /><circle className="hog-glint" cx={x - 8} cy="115" r="7" /><path className="hog-tear" d={`M${x + 22} 144q13 19 0 28q-13-9 0-28`} /></g>)}
    </g>
  );
  if (kind === "cursor") return (
    <g className="hog-eyes hog-eyes-cursor"><rect x="127" y="116" width="25" height="10" rx="3" /><rect className="cursor-blink" x="208" y="111" width="9" height="28" rx="2" /></g>
  );
  if (kind === "judging") return (
    <g className="hog-eyes hog-eyes-judging"><path d="M122 119q18-12 36 1" /><path d="M202 120q18-13 36-1" /><circle cx="143" cy="126" r="5" /><circle cx="217" cy="126" r="5" /></g>
  );
  if (kind === "shades") return (
    <g className="hog-shades"><path d="M112 113l58 5-5 33q-47 8-53-38ZM248 113l-58 5 5 33q47 8 53-38Z" /><path d="M167 122q13-8 26 0M108 112l-12-5M252 112l12-5" /></g>
  );
  return <g className="hog-eyes hog-eyes-plain"><circle cx="140" cy="126" r="7" /><circle cx="220" cy="126" r="7" /></g>;
}

function Mouth({ kind }: { kind: HogAppearance["mouth"] }) {
  if (kind === "veneers") return (
    <g className="hog-veneers"><path d="M146 197q34 25 68 0v-4h-68Z" /><path d="M163 198v10M180 199v12M197 198v10" /></g>
  );
  if (kind === "flat") return <path className="hog-line hog-mouth" d="M158 204h44" />;
  if (kind === "grin") return <path className="hog-line hog-mouth hog-grin" d="M145 195q35 39 70 0" />;
  return <path className="hog-line hog-mouth" d="M158 197q22 20 44 0" />;
}

function Outfit({ kind, rx }: { kind: HogAppearance["outfit"]; rx: number }) {
  if (kind === "blazer") return (
    <g className="hog-blazer">
      <path d={`M${180 - rx + 10} 151q17 72 56 82l30-72 24 72q39-10 56-82v74q-30 19-90 19t-90-19Z`} />
      <path className="hog-lapel" d="M149 145l31 36-24 25M211 145l-31 36 24 25" />
      <path className="hog-tie" d="M174 177h12l6 38-12 13-12-13Z" />
    </g>
  );
  if (kind === "cap") return (
    <g className="hog-cap"><path d="M112 93q54-62 122-8l-9 31q-54-23-111 1Z" /><path d="M218 103q38-4 55 13-35 10-58 1Z" /><circle cx="158" cy="62" r="7" /></g>
  );
  return null;
}

function BackAttachment({ kind }: { kind: HogAppearance["back"] }) {
  if (kind !== "keyboard") return null;
  return (
    <g className="hog-keyboard">
      <path d="M104 90l16-49h120l16 49Z" />
      {[0, 1, 2, 3].map(row => [0, 1, 2, 3, 4, 5].map(column => (
        <rect key={`${row}-${column}`} x={126 + column * 18 + row * 2} y={50 + row * 10} width="12" height="6" rx="1" />
      )))}
    </g>
  );
}

function Effects({ kind }: { kind: HogAppearance["effect"] }) {
  if (kind === "sparkles") return (
    <g className="hog-sparkles"><path d="M53 76l5 13 13 5-13 5-5 13-5-13-13-5 13-5ZM301 47l4 10 10 4-10 4-4 10-4-10-10-4 10-4ZM300 184l5 12 12 5-12 5-5 12-5-12-12-5 12-5Z" /></g>
  );
  if (kind === "chat") return (
    <g className="hog-chat"><path d="M275 48h58v45h-14l-10 12-1-12h-33Z" /><path d="M286 62h35M286 73h27" /></g>
  );
  if (kind === "flies") return (
    <g className="hog-flies"><path d="M66 116q12-16 22 0M274 72q12-16 22 0M287 190q12-16 22 0" /><circle cx="78" cy="116" r="4" /><circle cx="286" cy="72" r="4" /><circle cx="299" cy="190" r="4" /></g>
  );
  return null;
}
