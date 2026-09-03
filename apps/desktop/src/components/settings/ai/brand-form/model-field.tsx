import type { AiBrand, CliModelOption } from '../../../../types/ai-provider';

interface AiModelFieldProps {
  brand: AiBrand;
  model: string;
  models: CliModelOption[];
  onChange: (value: string) => void;
}

export function AiModelField({ brand, model, models, onChange }: AiModelFieldProps) {
  return (
    <div className="form-field" style={{ marginTop: 20 }}>
      <label htmlFor={`${brand}-model`}>모델</label>
      <select
        id={`${brand}-model`}
        className="filter-select"
        value={model}
        onChange={(e) => onChange(e.target.value)}
        disabled={models.length === 0}
      >
        {models.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
}
