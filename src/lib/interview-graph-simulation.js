/**
 * A small, deterministic graph simulation. Forces use the public Obsidian
 * Publish graph defaults; the implementation is independent of its runtime.
 * Coordinates and velocities stay in world units, outside the render loop.
 */
export const GRAPH_SIMULATION_DEFAULTS = Object.freeze({
  centerStrength: 0.1,
  linkStrength: 1,
  linkDistance: 250,
  repelStrength: 1000,
  repelDistanceMin: 30,
  velocityDamping: 0.6,
  collisionRadius: 60,
  collisionStrength: 0.5,
  alphaDecay: 1 - Math.pow(0.001, 1 / 300),
  alphaMin: 0.001,
  reheatAlpha: 0.3,
  dragAlphaTarget: 0.3,
  theta: 0.9,
});

const TAU = Math.PI * 2;
const POSITION_LIMIT = 1e9;

function nodeId(value) {
  if (value && typeof value === "object") value = value.id ?? value.key;
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const id = String(value);
  return id.length ? id : null;
}

function hashId(id) {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function direction(left, right) {
  const first = left < right ? left : right;
  const second = left < right ? right : left;
  const angle = hashId(`${first}\0${second}`) / 4294967296 * TAU;
  const sign = left < right ? 1 : -1;
  return [Math.cos(angle) * sign, Math.sin(angle) * sign];
}

function finitePosition(value) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= POSITION_LIMIT;
}

function chargeDenominator(dx, dy, distanceMin) {
  const distanceSquared = dx * dx + dy * dy;
  // Below distanceMin, this is distanceMin * distance (the square root of
  // distanceMin² * distance²), which caps an individual repulsion impulse.
  if (distanceSquared >= distanceMin * distanceMin) return Math.max(Number.MIN_VALUE, distanceSquared);
  return distanceMin * (Math.sqrt(distanceSquared) || Math.hypot(dx, dy));
}

function readOptions(options) {
  const result = { ...GRAPH_SIMULATION_DEFAULTS };
  for (const key of Object.keys(result)) {
    if (Number.isFinite(options[key]) && options[key] >= 0) result[key] = options[key];
  }
  result.velocityDamping = Math.min(1, result.velocityDamping);
  result.alphaDecay = Math.min(1, result.alphaDecay);
  result.alphaMin = Math.max(1e-8, result.alphaMin);
  result.theta = Math.max(0.1, result.theta);
  return result;
}

// Each cell stores its centre of mass. Tiny/coincident buckets terminate at a
// fixed depth, so malformed or coincident inputs cannot recurse indefinitely.
function buildChargeTree(nodes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  }
  const size = Math.max(maxX - minX, maxY - minY, 1) * 1.000001;

  function cell(indices, x, y, width, depth) {
    let sumX = 0;
    let sumY = 0;
    for (const index of indices) {
      sumX += nodes[index].x;
      sumY += nodes[index].y;
    }
    const result = { x, y, width, mass: indices.length, cx: sumX / indices.length, cy: sumY / indices.length };
    if (indices.length <= 4 || depth >= 20 || width < 1e-7) {
      result.indices = indices;
      return result;
    }
    const half = width / 2;
    const groups = [[], [], [], []];
    for (const index of indices) {
      const node = nodes[index];
      const quadrant = (node.x >= x + half ? 1 : 0) + (node.y >= y + half ? 2 : 0);
      groups[quadrant].push(index);
    }
    result.children = [];
    for (let quadrant = 0; quadrant < 4; quadrant += 1) {
      if (groups[quadrant].length) {
        result.children.push(cell(groups[quadrant], x + (quadrant % 2) * half,
          y + (quadrant >= 2 ? half : 0), half, depth + 1));
      }
    }
    return result;
  }

  return cell(nodes.map((_, index) => index), minX, minY, size, 0);
}

export function createGraphSimulation(options = {}) {
  const forces = readOptions(options);
  let nodes = [];
  let lookup = new Map();
  let links = [];
  let linkKeys = new Set();
  let alpha = 0;
  let alphaTarget = 0;
  let pinCount = 0;

  function isActive() {
    return nodes.length > 0 && (alpha > forces.alphaMin || alphaTarget > forces.alphaMin);
  }

  function reheat(value = forces.reheatAlpha) {
    if (nodes.length && Number.isFinite(value)) alpha = Math.max(alpha, Math.max(0, value));
    return isActive();
  }

  function setGraph(inputNodes = [], inputEdges = []) {
    const nextLookup = new Map();
    const added = [];
    let changed = false;
    for (const input of Array.isArray(inputNodes) ? inputNodes : []) {
      const id = nodeId(input);
      if (id === null || nextLookup.has(id)) continue;
      let node = lookup.get(id);
      if (!node) {
        const positioned = finitePosition(input?.x) && finitePosition(input?.y);
        node = { id, x: positioned ? input.x : 0, y: positioned ? input.y : 0,
          vx: 0, vy: 0, fx: null, fy: null, degree: 0, positioned };
        added.push(node);
        changed = true;
      }
      nextLookup.set(id, node);
    }
    if (nextLookup.size !== lookup.size) changed = true;
    for (const id of lookup.keys()) if (!nextLookup.has(id)) changed = true;

    const nextLinks = [];
    const nextLinkKeys = new Set();
    const neighbours = new Map();
    for (const node of nextLookup.values()) {
      node.degree = 0;
      neighbours.set(node.id, []);
    }
    for (const edge of Array.isArray(inputEdges) ? inputEdges : []) {
      const sourceId = nodeId(Array.isArray(edge) ? edge[0] : edge?.source);
      const targetId = nodeId(Array.isArray(edge) ? edge[1] : edge?.target);
      const source = nextLookup.get(sourceId);
      const target = nextLookup.get(targetId);
      if (!source || !target || source === target) continue;
      const key = JSON.stringify(sourceId < targetId ? [sourceId, targetId] : [targetId, sourceId]);
      if (nextLinkKeys.has(key)) continue;
      nextLinkKeys.add(key);
      nextLinks.push({ source, target });
      source.degree += 1;
      target.degree += 1;
      neighbours.get(sourceId).push(target);
      neighbours.get(targetId).push(source);
    }
    if (nextLinkKeys.size !== linkKeys.size) changed = true;
    for (const key of nextLinkKeys) if (!linkKeys.has(key)) changed = true;

    // Preserve all retained positions. New nodes start beside existing links;
    // nodes without a placed neighbour occupy a deterministic outer annulus.
    let outerRadius = 0;
    for (const node of nextLookup.values()) {
      if (node.positioned) outerRadius = Math.max(outerRadius, Math.hypot(node.x, node.y));
    }
    const annulusWidth = Math.sqrt(60 * 60 * added.length / Math.PI + outerRadius ** 2) - outerRadius;
    const neighbourSpread = 60 * Math.sqrt(Math.max(1, added.length));
    for (const node of added) {
      if (node.positioned) continue;
      const seed = hashId(node.id);
      const angle = seed / 4294967296 * TAU;
      const fraction = hashId(`${node.id}\0radius`) / 4294967296;
      const placed = neighbours.get(node.id).filter(neighbour => neighbour.positioned);
      if (placed.length) {
        const x = placed.reduce((sum, neighbour) => sum + neighbour.x, 0) / placed.length;
        const y = placed.reduce((sum, neighbour) => sum + neighbour.y, 0) / placed.length;
        const offset = (0.25 + fraction * 0.5) * neighbourSpread;
        node.x = x + Math.cos(angle) * offset;
        node.y = y + Math.sin(angle) * offset;
      } else {
        const radius = outerRadius + Math.sqrt(fraction) * Math.max(annulusWidth, 30);
        node.x = Math.cos(angle) * radius;
        node.y = Math.sin(angle) * radius;
      }
      node.positioned = true;
    }

    lookup = nextLookup;
    nodes = [...lookup.values()];
    links = nextLinks;
    linkKeys = nextLinkKeys;
    pinCount = nodes.reduce((count, node) => count + (node.fx === null ? 0 : 1), 0);
    alphaTarget = pinCount ? forces.dragAlphaTarget : 0;
    if (!nodes.length) alpha = 0;
    else if (changed) reheat();
    return getSnapshot();
  }

  function applyCharge() {
    if (nodes.length < 2 || forces.repelStrength === 0) return;
    const tree = buildChargeTree(nodes);
    const thetaSquared = forces.theta ** 2;
    const strength = forces.repelStrength * alpha;
    const stack = [];
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      stack.push(tree);
      while (stack.length) {
        const cell = stack.pop();
        if (cell.indices) {
          for (const otherIndex of cell.indices) {
            if (otherIndex === index) continue;
            const other = nodes[otherIndex];
            let dx = node.x - other.x;
            let dy = node.y - other.y;
            if (dx === 0 && dy === 0) [dx, dy] = direction(node.id, other.id);
            const denominator = chargeDenominator(dx, dy, forces.repelDistanceMin);
            node.vx += dx * strength / denominator;
            node.vy += dy * strength / denominator;
          }
          continue;
        }
        const dx = node.x - cell.cx;
        const dy = node.y - cell.cy;
        const distanceSquared = dx * dx + dy * dy;
        const containsNode = node.x >= cell.x && node.x <= cell.x + cell.width
          && node.y >= cell.y && node.y <= cell.y + cell.width;
        if (!containsNode && cell.width ** 2 < thetaSquared * distanceSquared) {
          const multiplier = strength * cell.mass / chargeDenominator(dx, dy, forces.repelDistanceMin);
          node.vx += dx * multiplier;
          node.vy += dy * multiplier;
        } else {
          for (const child of cell.children) stack.push(child);
        }
      }
    }
  }

  function applyCollision() {
    const diameter = forces.collisionRadius * 2;
    if (nodes.length < 2 || diameter === 0 || forces.collisionStrength === 0) return;
    const grid = new Map();
    // The grid is made from predicted positions, like a velocity-based collide
    // force. Each pair is visited once, including nodes on cell boundaries.
    const predictedX = new Float64Array(nodes.length);
    const predictedY = new Float64Array(nodes.length);
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const x = predictedX[index] = node.x + node.vx;
      const y = predictedY[index] = node.y + node.vy;
      const cellX = Math.floor(x / diameter);
      const cellY = Math.floor(y / diameter);
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const bucket = grid.get(`${cellX + offsetX},${cellY + offsetY}`);
          if (!bucket) continue;
          for (const otherIndex of bucket) {
            const other = nodes[otherIndex];
            let dx = x - predictedX[otherIndex];
            let dy = y - predictedY[otherIndex];
            let distance = Math.hypot(dx, dy);
            if (distance >= diameter) continue;
            if (distance === 0) {
              [dx, dy] = direction(node.id, other.id);
              distance = 1;
            }
            const multiplier = (diameter - distance) / distance * forces.collisionStrength * 0.5;
            node.vx += dx * multiplier;
            node.vy += dy * multiplier;
            other.vx -= dx * multiplier;
            other.vy -= dy * multiplier;
          }
        }
      }
      const key = `${cellX},${cellY}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(index);
      else grid.set(key, [index]);
    }
  }

  function tick(steps = 1) {
    const count = Number.isFinite(steps) ? Math.max(0, Math.min(10000, Math.floor(steps))) : 1;
    for (let step = 0; step < count && isActive(); step += 1) {
      alpha += (alphaTarget - alpha) * forces.alphaDecay;
      for (const node of nodes) {
        node.vx -= node.x * forces.centerStrength * alpha;
        node.vy -= node.y * forces.centerStrength * alpha;
      }
      for (const { source, target } of links) {
        let dx = target.x + target.vx - source.x - source.vx;
        let dy = target.y + target.vy - source.y - source.vy;
        let distance = Math.hypot(dx, dy);
        if (distance === 0) {
          [dx, dy] = direction(target.id, source.id);
          distance = 1;
        }
        const spring = (distance - forces.linkDistance) / distance * alpha
          * forces.linkStrength / Math.max(1, Math.min(source.degree, target.degree));
        const bias = source.degree / (source.degree + target.degree);
        target.vx -= dx * spring * bias;
        target.vy -= dy * spring * bias;
        source.vx += dx * spring * (1 - bias);
        source.vy += dy * spring * (1 - bias);
      }
      applyCharge();
      applyCollision();
      for (const node of nodes) {
        if (node.fx !== null) {
          node.x = node.fx;
          node.y = node.fy;
          node.vx = node.vy = 0;
        } else {
          node.vx *= forces.velocityDamping;
          node.vy *= forces.velocityDamping;
          node.x += node.vx;
          node.y += node.vy;
          if (!finitePosition(node.x) || !finitePosition(node.y)) {
            node.x = node.y = node.vx = node.vy = 0;
          }
        }
      }
      if (alphaTarget === 0 && alpha <= forces.alphaMin) {
        alpha = 0;
        for (const node of nodes) node.vx = node.vy = 0;
      }
    }
    return getSnapshot();
  }

  function getSnapshot() {
    const positions = new Float32Array(nodes.length * 2);
    for (let index = 0; index < nodes.length; index += 1) {
      positions[index * 2] = nodes[index].x;
      positions[index * 2 + 1] = nodes[index].y;
    }
    return { ids: nodes.map(node => node.id), positions, alpha, active: isActive() };
  }

  function pinNode(id, x, y) {
    const node = lookup.get(nodeId(id));
    if (!node || !finitePosition(x) || !finitePosition(y)) return false;
    if (node.fx === null) pinCount += 1;
    node.x = node.fx = x;
    node.y = node.fy = y;
    node.vx = node.vy = 0;
    alphaTarget = forces.dragAlphaTarget;
    reheat();
    return true;
  }

  function releaseNode(id) {
    const node = lookup.get(nodeId(id));
    if (!node || node.fx === null) return false;
    node.fx = node.fy = null;
    pinCount -= 1;
    alphaTarget = pinCount ? forces.dragAlphaTarget : 0;
    return true;
  }

  function stop() {
    alpha = alphaTarget = pinCount = 0;
    for (const node of nodes) {
      node.fx = node.fy = null;
      node.vx = node.vy = 0;
    }
  }

  return { setGraph, tick, getSnapshot, pinNode, releaseNode, reheat, isActive, stop };
}
