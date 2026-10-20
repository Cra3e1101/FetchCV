function nextContentLine(lines, from) {
  for (let index = from; index < lines.length; index += 1) {
    if (lines[index].trim()) return index;
  }
  return -1;
}

export function splitJobDescriptions(source) {
  const text = String(source || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];
  const lines = text.split("\n");
  const starts = [];
  for (let index = 0; index < lines.length; index += 1) {
    const company = lines[index].trim();
    if (!company || company.length > 40 || /[：:；;，,。.!！?？]/.test(company)) continue;
    if (index > 0 && lines[index - 1].trim()) continue;
    const roleIndex = nextContentLine(lines, index + 1);
    const markerIndex = nextContentLine(lines, roleIndex + 1);
    if (roleIndex < 0 || markerIndex < 0) continue;
    const role = lines[roleIndex].trim();
    const marker = lines[markerIndex].trim();
    if (!role || role.length > 160 || !/^(职位描述|工作职责|岗位职责|职位简介)/.test(marker)) continue;
    starts.push({ index, company, role });
  }
  return starts.map((item, position) => {
    const end = starts[position + 1]?.index ?? lines.length;
    return {
      company: item.company,
      role: item.role,
      jd: lines.slice(item.index, end).join("\n").trim(),
    };
  });
}
