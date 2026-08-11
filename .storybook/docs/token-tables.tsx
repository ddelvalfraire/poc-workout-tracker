import Color from "colorjs.io";

import {
  COLORS,
  DURATIONS,
  FONTS,
  RADII,
  TOUCH_TARGETS,
  TYPE_SCALE,
  type TokenStatus,
} from "../../src/design/tokens";

/**
 * Live token tables for the Design/Design Tokens page.
 *
 * They read `src/design/tokens.ts` directly, so the documentation cannot drift
 * from the source the platforms are generated from — a hand-written table
 * would be one more thing to forget to update.
 *
 * `colorjs.io` is a devDependency and this file only ever runs inside
 * Storybook, so nothing here reaches the app bundle.
 */

const cell: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderBottom: "1px solid var(--border)",
  textAlign: "left",
  verticalAlign: "top",
};

const head: React.CSSProperties = {
  ...cell,
  fontSize: "0.75rem",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "var(--muted-foreground)",
  fontWeight: 400,
};

const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "0.8125rem",
  whiteSpace: "nowrap",
};

function Table({
  columns,
  children,
}: {
  columns: string[];
  children: React.ReactNode;
}) {
  return (
    <div style={{ overflowX: "auto", margin: "1.5rem 0" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "36rem" }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} style={head}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** The exact value the generator compiles into Swift and Kotlin. */
function srgbOf(oklch: string): { hex: string; alpha: number } {
  const color = new Color(oklch);
  const alpha = typeof color.alpha === "number" ? color.alpha : 1;
  const [r, g, b] = color.to("srgb").coords.map((n) => (typeof n === "number" ? n : 0));
  const byte = (n: number) =>
    Math.round(Math.min(1, Math.max(0, n)) * 255)
      .toString(16)
      .padStart(2, "0");
  return { hex: `#${byte(r)}${byte(g)}${byte(b)}`.toUpperCase(), alpha };
}

export function ColorTable({ status }: { status: TokenStatus }) {
  const rows = COLORS.filter((c) => c.status === status);
  return (
    <Table columns={["", "Token", "OKLCH (web)", "sRGB (iOS / Android)", "Use"]}>
      {rows.map((token) => {
        const { hex, alpha } = srgbOf(token.oklch);
        return (
          <tr key={token.name}>
            <td style={cell}>
              <span
                style={{
                  display: "block",
                  width: "2.5rem",
                  height: "1.75rem",
                  borderRadius: "0.375rem",
                  background: token.oklch,
                  outline: "1px solid var(--border)",
                  outlineOffset: "-1px",
                }}
              />
            </td>
            <td style={{ ...cell, ...mono }}>--{token.name}</td>
            <td style={{ ...cell, ...mono, color: "var(--muted-foreground)" }}>
              {token.oklch}
            </td>
            <td style={{ ...cell, ...mono }}>
              {hex}
              {alpha < 1 && (
                <span style={{ color: "var(--muted-foreground)" }}>
                  {" "}
                  @ {Math.round(alpha * 100)}%
                </span>
              )}
            </td>
            <td style={{ ...cell, fontSize: "0.8125rem", color: "var(--muted-foreground)" }}>
              {token.doc}
            </td>
          </tr>
        );
      })}
    </Table>
  );
}

export function DimensionTable({ which }: { which: "radii" | "touch" }) {
  const rows = which === "radii" ? RADII : TOUCH_TARGETS;
  return (
    <Table columns={["", "Token", "Value", "Use"]}>
      {rows.map((token) => (
        <tr key={token.name}>
          <td style={cell}>
            <span
              style={{
                display: "block",
                width: "3rem",
                height: "2rem",
                background: "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius:
                  which === "radii" ? `${Math.min(token.value, 16)}px` : "0.25rem",
              }}
            />
          </td>
          <td style={{ ...cell, ...mono }}>{token.name}</td>
          <td style={{ ...cell, ...mono }}>{token.value}</td>
          <td style={{ ...cell, fontSize: "0.8125rem", color: "var(--muted-foreground)" }}>
            {token.doc}
          </td>
        </tr>
      ))}
    </Table>
  );
}

export function DurationTable() {
  return (
    <Table columns={["Token", "ms", "Use"]}>
      {DURATIONS.map((token) => (
        <tr key={token.name}>
          <td style={{ ...cell, ...mono }}>{token.name}</td>
          <td style={{ ...cell, ...mono }}>{token.value}</td>
          <td style={{ ...cell, fontSize: "0.8125rem", color: "var(--muted-foreground)" }}>
            {token.doc}
          </td>
        </tr>
      ))}
    </Table>
  );
}

export function FontTable() {
  return (
    <Table columns={["Sample", "Token", "Family", "Use"]}>
      {FONTS.map((token) => (
        <tr key={token.name}>
          <td
            style={{
              ...cell,
              fontFamily: `var(--${token.name})`,
              fontSize: "1.375rem",
              textTransform: token.name === "font-display" ? "uppercase" : "none",
            }}
          >
            Bench press
          </td>
          <td style={{ ...cell, ...mono }}>--{token.name}</td>
          <td style={{ ...cell, ...mono }}>{token.native}</td>
          <td style={{ ...cell, fontSize: "0.8125rem", color: "var(--muted-foreground)" }}>
            {token.doc}
          </td>
        </tr>
      ))}
    </Table>
  );
}

export function TypeScaleTable() {
  return (
    <Table columns={["Sample", "Token", "Size / line", "Use"]}>
      {TYPE_SCALE.map((token) => (
        <tr key={token.name}>
          <td
            style={{
              ...cell,
              fontSize: `${token.size}px`,
              lineHeight: `${token.lineHeight}px`,
            }}
          >
            102.5 kg
          </td>
          <td style={{ ...cell, ...mono }}>{token.name}</td>
          <td style={{ ...cell, ...mono }}>
            {token.size} / {token.lineHeight}
          </td>
          <td style={{ ...cell, fontSize: "0.8125rem", color: "var(--muted-foreground)" }}>
            {token.doc}
          </td>
        </tr>
      ))}
    </Table>
  );
}
