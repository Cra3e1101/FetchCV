const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const displayText = value => String(value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ");
const entityKey = value => displayText(value).toLowerCase();
const recordId = record => record?.id == null ? "" : String(record.id);

function recordTimestamp(record) {
  for (const value of [record.updated_at, record.created_at]) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function newestRecords(records) {
  const unique = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const id = recordId(record);
    if (!id || typeof record !== "object") continue;
    const previous = unique.get(id);
    if (!previous || recordTimestamp(record) > recordTimestamp(previous)) unique.set(id, record);
  }
  return [...unique.values()].sort((left, right) => (
    recordTimestamp(right) - recordTimestamp(left) || compareText(recordId(left), recordId(right))
  ));
}

function preferredText(left, right) {
  if (!left) return right;
  if (!right) return left;
  return compareText(left, right) <= 0 ? left : right;
}

/** Build only recorded entity membership and explicit brief-to-source references. */
export function buildKnowledgeGraph({ sources = [], briefs = [] } = {}) {
  const nodes = new Map();
  const edges = new Map();

  function addNode(node) {
    const result = { ...node, sourceIds: new Set(), briefIds: new Set() };
    nodes.set(result.id, result);
    return result;
  }

  function addEdge(kind, source, target, briefId) {
    const id = `edge:${JSON.stringify([kind, source, target])}`;
    let edge = edges.get(id);
    if (!edge) {
      edge = { id, source, target, kind, briefIds: new Set() };
      edges.set(id, edge);
    }
    if (briefId) edge.briefIds.add(briefId);
  }

  function entities(record) {
    const company = displayText(record.company);
    const businessUnit = displayText(record.business_unit);
    const role = displayText(record.role);
    const companyId = `company:${entityKey(company)}`;
    const roleId = `role:${JSON.stringify([entityKey(company), entityKey(businessUnit), entityKey(role)])}`;
    let companyNode = nodes.get(companyId);
    if (!companyNode) {
      companyNode = addNode({ id: companyId, kind: "company", label: "", company: "", businessUnit: "", role: "" });
    }
    companyNode.company = preferredText(companyNode.company, company);
    companyNode.label = companyNode.company || "未归类";

    let roleNode = nodes.get(roleId);
    if (!roleNode) {
      roleNode = addNode({ id: roleId, kind: "role", label: "", company: "", businessUnit: "", role: "", briefs: [] });
    }
    roleNode.company = preferredText(roleNode.company, company);
    roleNode.businessUnit = preferredText(roleNode.businessUnit, businessUnit);
    roleNode.role = preferredText(roleNode.role, role);
    roleNode.label = roleNode.role || "未指定岗位";
    addEdge("company-role", companyId, roleId);
    return { companyNode, roleNode };
  }

  const sourceNodes = new Map();
  for (const source of newestRecords(sources)) {
    const sourceId = recordId(source);
    const { companyNode, roleNode } = entities(source);
    const node = addNode({
      id: `source:${sourceId}`,
      kind: "source",
      label: displayText(source.title) || "公开面试经验",
      company: displayText(source.company),
      businessUnit: displayText(source.business_unit),
      role: displayText(source.role),
      source,
    });
    sourceNodes.set(sourceId, node);
    node.sourceIds.add(sourceId);
    companyNode.sourceIds.add(sourceId);
    roleNode.sourceIds.add(sourceId);
    addEdge("role-source", roleNode.id, node.id);
  }

  for (const brief of newestRecords(briefs)) {
    const briefId = recordId(brief);
    const { companyNode, roleNode } = entities(brief);
    companyNode.briefIds.add(briefId);
    roleNode.briefIds.add(briefId);
    roleNode.briefs.push(brief);
    addEdge("company-role", companyNode.id, roleNode.id, briefId);

    for (const sourceId of Array.isArray(brief.source_ids) ? brief.source_ids : []) {
      const sourceNode = sourceNodes.get(String(sourceId));
      if (!sourceNode) continue;
      const originalId = recordId(sourceNode.source);
      companyNode.sourceIds.add(originalId);
      roleNode.sourceIds.add(originalId);
      sourceNode.briefIds.add(briefId);
      addEdge("role-source", roleNode.id, sourceNode.id, briefId);
    }
  }

  const sortedIds = values => [...values].sort(compareText);
  return {
    nodes: [...nodes.values()].sort((left, right) => compareText(left.id, right.id)).map(node => ({
      ...node,
      company: node.company || "未归类",
      role: node.kind === "company" ? "" : node.role || "未指定岗位",
      sourceIds: sortedIds(node.sourceIds),
      briefIds: sortedIds(node.briefIds),
      weight: Math.min(1, (node.kind === "source" ? node.briefIds.size : node.sourceIds.size) / 8),
    })),
    edges: [...edges.values()].sort((left, right) => compareText(left.id, right.id)).map(edge => ({
      ...edge,
      briefIds: sortedIds(edge.briefIds),
    })),
  };
}
