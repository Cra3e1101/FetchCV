import { AppearancePreview } from "./AppearancePreview";
import { SegmentedControl } from "./SegmentedControl";

const DENSITIES = [
  { id: "comfortable", label: "舒适", description: "更宽松的列表与内容间距" },
  { id: "compact", label: "紧凑", description: "更紧凑的间距，显示更多内容" },
].map((density) => ({ ...density, preview: <AppearancePreview density={density.id} /> }));

export function InterfaceDensityPicker({ value, onChange }) {
  return <SegmentedControl aria-label="界面密度" variant="preview" tabs={DENSITIES} value={value} onChange={onChange} />;
}
