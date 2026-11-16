export type SelectControlEvidence = {
  key: string;
  tag: string;
  multiple: boolean;
  disabled: boolean;
  options: Array<{ value: string; disabled: boolean }>;
};

export function compareOptionSelects(source: unknown, target: unknown) {
  const reasons: string[] = [];
  if (!Array.isArray(source) || !Array.isArray(target))
    return { passed: false, reasons: ["missing option-select evidence; recapture required"] };
  for (const control of source as SelectControlEvidence[]) {
    const matches = (target as SelectControlEvidence[]).filter(candidate => candidate.key === control.key);
    const match = matches[0];
    if (!control.key || matches.length !== 1 || match.tag !== "select") {
      reasons.push(`${control.key || "unknown"}: expected exactly one native select`);
      continue;
    }
    if (match.multiple !== control.multiple || match.disabled !== control.disabled)
      reasons.push(`${control.key}: selection mode or availability differs`);
    if (!Array.isArray(control.options) || !Array.isArray(match.options)) {
      reasons.push(`${control.key}: missing option availability evidence`);
      continue;
    }
    const values = (options: SelectControlEvidence["options"]) => options.map(option => option.value);
    if (JSON.stringify(values(control.options)) !== JSON.stringify(values(match.options)))
      reasons.push(`${control.key}: options or order differ`);
    const enabled = (options: SelectControlEvidence["options"]) => values(options.filter(option => !option.disabled));
    if (JSON.stringify(enabled(control.options)) !== JSON.stringify(enabled(match.options)))
      reasons.push(`${control.key}: enabled options differ at this state`);
  }
  return { passed: reasons.length === 0, reasons };
}
