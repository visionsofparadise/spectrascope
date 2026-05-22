import type { LayerColor } from "../../layers";

interface LoudnessKeyProps {
  readonly layerColor: LayerColor;
}

export function LoudnessKey({ layerColor }: LoudnessKeyProps) {
  // Per the Layer Color Model: all of a layer's overlay-trace legend entries
  // share layerColor.primary. The legend entries differ in label only;
  // line weight / dash pattern is left to the rendered overlay.
  const traceColor = layerColor.primary;
  const legendItems = [
    { label: "Waveform", color: traceColor },
    { label: "LUFS", color: traceColor },
    { label: "RMS", color: traceColor },
    { label: "Peak", color: traceColor },
  ];

  return (
    <div className="flex gap-4 py-1 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">
      {legendItems.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2"
            style={{ backgroundColor: item.color }}
          />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
