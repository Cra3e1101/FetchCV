import { useEffect, useMemo, useRef } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { clampGraphZoom, createGraphMotionTransport, graphLerp, wrapGraphLabel } from "../lib/interview-graph-motion.js";

const FRAME = 1000 / 60;
const number = value => Number(value.toFixed(3));
const rgb = channels => `rgb(${channels.map(channel => Math.round(channel)).join(",")})`;
const parseColor = value => [0, 2, 4].map(offset => parseInt(value.trim().replace("#", "").slice(offset, offset + 2), 16));

// React owns content and accessibility; this controller only paints motion.
function createGraphController(container, svg, scene, callbacks) {
  const bounds = container.getBoundingClientRect();
  let width = Math.max(1, bounds.width), height = Math.max(1, bounds.height);
  let graph = { nodes: [], edges: [], byId: new Map(), neighbors: new Map() };
  let highlighted = null;
  let coordinates = new Map();
  let nodeElements = new Map();
  let edgeElements = [];
  let frame = null;
  let lastFrame = 0;
  let disposed = false;
  let fitted = false;
  let hoverId = null;
  let focusId = null;
  let selectedNodeId = null;
  let gesture = null;
  let clickNodeId = null;
  let pendingPin = null;
  let suppressClick = false;
  let velocityX = 0, velocityY = 0;
  const pointers = new Map();
  const keys = new Set();
  const camera = { x: width / 2, y: height / 2, zoom: 1, target: 1, anchorX: width / 2, anchorY: height / 2 };
  const attributes = new WeakMap();
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = media.matches;
  let colors;
  const paint = (element, name, value) => {
    if (!element) return;
    let cache = attributes.get(element);
    if (!cache) { cache = {}; attributes.set(element, cache); }
    if (cache[name] === value) return;
    cache[name] = value;
    if (name.startsWith("style:")) element.style[name.slice(6)] = value;
    else element.setAttribute(name, value);
  };
  const wake = () => { if (!disposed && frame === null) frame = requestAnimationFrame(draw); };
  const readColors = () => {
    const style = getComputedStyle(container);
    colors = {
      node: parseColor(style.getPropertyValue("--ik-node-fill") || "#8a8a8a"),
      company: parseColor(style.getPropertyValue("--ik-node-fill-company") || "#3a3a3a"),
      role: parseColor(style.getPropertyValue("--ik-node-fill-role") || "#5a5a5a"),
      edge: parseColor(style.getPropertyValue("--ik-edge") || "#d4d4d4"),
      active: parseColor(style.getPropertyValue("--ik-highlight") || "#b07d3a"),
    };
    wake();
  };
  const transport = createGraphMotionTransport(snapshot => {
    if (disposed) return;
    coordinates = new Map(snapshot.ids.map((id, index) => [id, { x: snapshot.positions[index * 2], y: snapshot.positions[index * 2 + 1] }]));
    paint(svg, "data-simulation-active", String(snapshot.active));
    if (!fitted && graph.nodes.length && coordinates.size) { fitted = true; fit(true); }
    wake();
  }, { reducedMotion, onEngineChange: engine => paint(svg, "data-motion-engine", engine) });

  function fit(immediate = false) {
    if (!coordinates.size) return;
    fitted = true;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    graph.nodes.forEach(node => {
      const point = coordinates.get(node.id);
      if (!point) return;
      left = Math.min(left, point.x - node.radius); right = Math.max(right, point.x + node.radius);
      top = Math.min(top, point.y - node.radius); bottom = Math.max(bottom, point.y + node.radius);
    });
    if (!Number.isFinite(left)) return;
    const zoom = clampGraphZoom(Math.min(Math.max(40, width - 100) / Math.max(1, right - left), Math.max(40, height - 120) / Math.max(1, bottom - top), 1));
    velocityX = velocityY = 0;
    camera.x = width / 2 - (left + right) / 2 * camera.zoom;
    camera.y = height / 2 - (top + bottom) / 2 * camera.zoom;
    camera.target = zoom;
    camera.anchorX = width / 2; camera.anchorY = height / 2;
    if (immediate || reducedMotion) {
      camera.zoom = zoom;
      camera.x = width / 2 - (left + right) / 2 * zoom;
      camera.y = height / 2 - (top + bottom) / 2 * zoom;
    }
    wake();
  }
  function changeZoom(factor, point) {
    fitted = true;
    const target = clampGraphZoom(camera.target * factor);
    const anchor = target < camera.zoom ? { x: width / 2, y: height / 2 } : point || { x: width / 2, y: height / 2 };
    camera.target = target;
    camera.anchorX = anchor.x; camera.anchorY = anchor.y;
    wake();
  }
  function draw(timestamp) {
    frame = null;
    if (disposed) return;
    flushPin();
    const elapsed = lastFrame ? Math.max(1, Math.min(64, timestamp - lastFrame)) : FRAME;
    const frames = elapsed / FRAME;
    lastFrame = timestamp;
    let moving = false;
    if (!gesture && !reducedMotion) {
      const multiplier = keys.has("Shift") ? 3 : 1;
      const targetX = ((keys.has("ArrowLeft") ? 1 : 0) - (keys.has("ArrowRight") ? 1 : 0)) * multiplier;
      const targetY = ((keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0)) * multiplier;
      camera.x += velocityX * elapsed; camera.y += velocityY * elapsed;
      velocityX = graphLerp(velocityX, targetX, 0.9, frames);
      velocityY = graphLerp(velocityY, targetY, 0.9, frames);
      if (Math.abs(velocityX) < 0.001 && !targetX) velocityX = 0;
      if (Math.abs(velocityY) < 0.001 && !targetY) velocityY = 0;
      moving ||= !!(velocityX || velocityY);
    }
    if (Math.abs(camera.target / camera.zoom - 1) > 0.0001) {
      const nextZoom = reducedMotion ? camera.target : graphLerp(camera.zoom, camera.target, 0.88, frames);
      const ratio = nextZoom / camera.zoom;
      camera.x = camera.anchorX - (camera.anchorX - camera.x) * ratio;
      camera.y = camera.anchorY - (camera.anchorY - camera.y) * ratio;
      camera.zoom = nextZoom;
      moving ||= !reducedMotion;
    } else camera.zoom = camera.target;
    paint(scene, "transform", `translate(${number(camera.x)} ${number(camera.y)}) scale(${camera.zoom})`);
    paint(svg, "data-zoom", String(camera.zoom));
    const zoomLabel = container.querySelector(".ik-graph-controls > span");
    if (zoomLabel && zoomLabel.textContent !== `${Math.round(camera.zoom * 100)}%`) zoomLabel.textContent = `${Math.round(camera.zoom * 100)}%`;
    const nodeScale = Math.sqrt(1 / camera.zoom);
    const textAlpha = Math.max(0, Math.min(1, Math.log2(camera.zoom) + 2));
    const activeId = gesture?.nodeId || hoverId || focusId || (!highlighted?.size ? selectedNodeId : null);
    const neighbors = activeId ? graph.neighbors.get(activeId) : null;
    for (const node of graph.nodes) {
      const visual = nodeElements.get(node.id);
      if (!visual) continue;
      let point = coordinates.get(node.id);
      if (gesture?.nodeId === node.id && gesture.moved && gesture.world) point = gesture.world;
      if (!point) { paint(visual.group, "visibility", "hidden"); continue; }
      paint(visual.group, "visibility", "visible");
      const active = activeId === node.id || selectedNodeId === node.id;
      const matching = !activeId && highlighted?.has(node.id);
      const dim = activeId ? !neighbors?.has(node.id) : highlighted?.size > 0 && !matching;
      const targetAlpha = dim ? 0.2 : 1;
      visual.alpha = reducedMotion ? targetAlpha : graphLerp(visual.alpha, targetAlpha, 0.80, frames);
      if (Math.abs(visual.alpha - targetAlpha) < 0.001) visual.alpha = targetAlpha;
      else moving = true;
      const targetMove = active ? 15 : 0;
      visual.move = reducedMotion ? targetMove : graphLerp(visual.move, targetMove, 0.75, frames);
      if (Math.abs(visual.move - targetMove) < 0.01) visual.move = targetMove;
      else moving = true;
      const baseColor = node.kind === "company" ? colors.company
        : node.kind === "role" ? colors.role
        : colors.node;
      const targetColor = active || matching ? colors.active : baseColor;
      visual.color = visual.color.map((channel, index) => {
        const next = reducedMotion ? targetColor[index] : graphLerp(channel, targetColor[index], 0.82, frames);
        if (Math.abs(next - targetColor[index]) > 0.5) moving = true;
        return Math.abs(next - targetColor[index]) < 0.5 ? targetColor[index] : next;
      });
      paint(visual.group, "transform", `translate(${number(point.x)} ${number(point.y)})`);
      paint(visual.group, "style:opacity", "1");
      paint(visual.group, "data-visual-opacity", String(number(visual.alpha)));
      paint(visual.group, "data-highlighted", String(active));
      paint(visual.dot, "r", String(number(node.radius * nodeScale)));
      paint(visual.dot, "style:fill", rgb(visual.color));
      paint(visual.dot, "style:opacity", String(number(visual.alpha)));
      paint(visual.target, "r", String(number(node.radius * nodeScale + 2 / camera.zoom)));
      paint(visual.ring, "r", String(number(node.radius * nodeScale + 0.7 / camera.zoom)));
      paint(visual.ring, "style:opacity", active ? "1" : "0");
      const scale = active && camera.zoom < 1 ? 1 / camera.zoom : nodeScale;
      const labelY = (node.radius + 5) * nodeScale + visual.move / camera.zoom;
      paint(visual.text, "transform", `translate(0 ${number(labelY)}) scale(${scale})`);
      const isSource = node.kind === "source";
      const baseOpacity = isSource && !active ? 0 : textAlpha;
      paint(visual.text, "style:opacity", String(number(active ? 1 : baseOpacity * visual.alpha)));
      paint(visual.text, "data-label-hidden", !active && baseOpacity < 0.001 ? "true" : "false");
    }
    for (const visual of edgeElements) {
      const fromNode = graph.byId.get(visual.edge.source), toNode = graph.byId.get(visual.edge.target);
      let from = coordinates.get(visual.edge.source), to = coordinates.get(visual.edge.target);
      if (gesture?.moved && gesture.world) {
        if (gesture.nodeId === visual.edge.source) from = gesture.world;
        if (gesture.nodeId === visual.edge.target) to = gesture.world;
      }
      if (!from || !to || !fromNode || !toNode) continue;
      const dx = to.x - from.x, dy = to.y - from.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const start = Math.min(distance / 2, fromNode.radius * nodeScale), end = Math.min(distance / 2, toNode.radius * nodeScale);
      paint(visual.line, "x1", String(number(from.x + dx / distance * start)));
      paint(visual.line, "y1", String(number(from.y + dy / distance * start)));
      paint(visual.line, "x2", String(number(to.x - dx / distance * end)));
      paint(visual.line, "y2", String(number(to.y - dy / distance * end)));
      const active = activeId && (visual.edge.source === activeId || visual.edge.target === activeId);
      const dim = activeId ? !active : highlighted?.size > 0 && !(highlighted.has(visual.edge.source) && highlighted.has(visual.edge.target));
      const targetAlpha = dim ? 0.2 : 1;
      visual.alpha = reducedMotion ? targetAlpha : graphLerp(visual.alpha, targetAlpha, 0.78, frames);
      if (Math.abs(visual.alpha - targetAlpha) < 0.001) visual.alpha = targetAlpha;
      else moving = true;
      const targetColor = active ? colors.active : colors.edge;
      visual.color = visual.color.map((channel, index) => {
        const next = reducedMotion ? targetColor[index] : graphLerp(channel, targetColor[index], 0.9, frames);
        if (Math.abs(next - targetColor[index]) > 0.5) moving = true;
        return Math.abs(next - targetColor[index]) < 0.5 ? targetColor[index] : next;
      });
      paint(visual.line, "style:opacity", String(number(visual.alpha)));
      paint(visual.line, "style:stroke", rgb(visual.color));
    }
    if (moving) wake();
    else lastFrame = 0;
  }
  const localPoint = event => {
    const rectangle = svg.getBoundingClientRect();
    return { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top };
  };
  const worldPoint = point => ({ x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom });
  const closestNode = target => target instanceof Element ? target.closest(".ik-node")?.getAttribute("data-node-id") : null;
  const capture = pointerId => { try { svg.setPointerCapture(pointerId); } catch { /* The native pointer may already have been cancelled. */ } };
  const releaseCapture = pointerId => { if (svg.hasPointerCapture(pointerId)) svg.releasePointerCapture(pointerId); };
  function flushPin() {
    if (!pendingPin) return;
    const point = pendingPin; pendingPin = null;
    transport.pinNode(point.id, point.x, point.y);
  }
  const stopGesture = (cancel = true) => {
    const previous = gesture;
    flushPin();
    if (previous?.nodeId && previous.world) coordinates.set(previous.nodeId, previous.world);
    gesture = null;
    if (previous?.nodeId && previous.moved) transport.releaseNode(previous.nodeId);
    if (cancel || previous?.kind !== "pan" || performance.now() - previous.lastMove > 100 || reducedMotion) velocityX = velocityY = 0;
    else { velocityX = previous.vx / Math.max(1, previous.dt); velocityY = previous.vy / Math.max(1, previous.dt); }
    if (cancel) {
      const captured = [...pointers.keys()]; pointers.clear(); captured.forEach(releaseCapture);
    }
    container.classList.remove("is-dragging");
    wake();
  };
  const startPinch = () => {
    flushPin();
    if (gesture?.nodeId && gesture.moved) transport.releaseNode(gesture.nodeId);
    const [first, second] = [...pointers.values()];
    gesture = { kind: "pinch", moved: true, center: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }, distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)) };
    suppressClick = true; velocityX = velocityY = 0;
    container.classList.add("is-dragging"); wake();
  };
  const pointerDown = event => {
    if (event.button !== 0 && event.pointerType !== "touch") return;
    if (pointers.size && event.pointerType !== "touch") return;
    fitted = true;
    const point = localPoint(event);
    pointers.set(event.pointerId, { ...point, type: event.pointerType }); capture(event.pointerId);
    if (pointers.size > 1) { startPinch(); return; }
    let nodeId = closestNode(event.target);
    if (event.pointerType === "touch") {
      let nearest = Infinity;
      for (const node of graph.nodes) {
        const position = coordinates.get(node.id);
        if (!position) continue;
        const distance = Math.hypot(position.x * camera.zoom + camera.x - point.x, position.y * camera.zoom + camera.y - point.y);
        if (distance < nearest && distance <= Math.max(22, node.radius * Math.sqrt(camera.zoom) + 2)) { nearest = distance; nodeId = node.id; }
      }
    }
    const coordinate = coordinates.get(nodeId), world = worldPoint(point);
    suppressClick = false; clickNodeId = null; velocityX = velocityY = 0;
    gesture = { kind: nodeId ? "node" : "pan", nodeId, pointerId: event.pointerId, start: point, previous: point, cameraX: camera.x, cameraY: camera.y, offsetX: coordinate ? coordinate.x - world.x : 0, offsetY: coordinate ? coordinate.y - world.y : 0, moved: false, lastMove: performance.now(), vx: 0, vy: 0, dt: FRAME };
    if (!nodeId) svg.focus({ preventScroll: true });
    wake();
  };
  const pointerMove = event => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    const point = localPoint(event); pointers.set(event.pointerId, { ...point, type: event.pointerType });
    if (gesture.kind === "pinch") {
      const [first, second] = [...pointers.values()]; if (!second) return;
      const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
      camera.x += center.x - gesture.center.x; camera.y += center.y - gesture.center.y;
      camera.target = clampGraphZoom(camera.target * distance / gesture.distance);
      camera.anchorX = center.x; camera.anchorY = center.y; gesture.center = center; gesture.distance = distance;
      wake(); return;
    }
    if (gesture.pointerId !== event.pointerId) return;
    const dx = point.x - gesture.start.x, dy = point.y - gesture.start.y;
    if (!gesture.moved && Math.hypot(dx, dy) <= 5) return;
    gesture.moved = true; suppressClick = true; container.classList.add("is-dragging");
    if (gesture.kind === "node") {
      const world = worldPoint(point);
      gesture.world = { x: world.x + gesture.offsetX, y: world.y + gesture.offsetY };
      pendingPin = { id: gesture.nodeId, ...gesture.world };
    } else {
      const now = performance.now();
      gesture.dt = graphLerp(gesture.dt, Math.max(1, now - gesture.lastMove), 0.8);
      gesture.vx = graphLerp(gesture.vx, point.x - gesture.previous.x, 0.8);
      gesture.vy = graphLerp(gesture.vy, point.y - gesture.previous.y, 0.8);
      gesture.lastMove = now; camera.x = gesture.cameraX + dx; camera.y = gesture.cameraY + dy;
    }
    gesture.previous = point; wake();
  };
  const pointerUp = event => {
    if (!pointers.has(event.pointerId)) return;
    clickNodeId = gesture?.moved ? null : gesture?.nodeId;
    pointers.delete(event.pointerId);
    if (gesture?.kind === "pinch" && pointers.size > 1) startPinch();
    else if (gesture?.kind === "pinch" && pointers.size) {
      const [pointerId, point] = [...pointers.entries()][0];
      gesture = { kind: "pan", pointerId, start: point, previous: point, cameraX: camera.x, cameraY: camera.y, moved: true, lastMove: -Infinity, vx: 0, vy: 0, dt: FRAME };
    } else stopGesture(false);
    releaseCapture(event.pointerId);
  };
  const pointerCancel = () => { suppressClick = true; stopGesture(); };
  const lostCapture = event => { if (pointers.has(event.pointerId)) pointerCancel(); };
  const pointerOver = event => { if (event.pointerType !== "touch") { hoverId = closestNode(event.target); wake(); } };
  const pointerOut = event => { if (event.pointerType !== "touch") { hoverId = closestNode(event.relatedTarget); wake(); } };
  const click = event => {
    if (suppressClick) { event.preventDefault(); return; }
    const nodeId = clickNodeId || closestNode(event.target);
    clickNodeId = null;
    if (nodeId) callbacks.current.onSelect(nodeId);
    else callbacks.current.onClear();
  };
  const wheel = event => {
    event.preventDefault();
    changeZoom(Math.pow(1.5, -event.deltaY * (event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1) / 120), localPoint(event));
  };
  const keyDown = event => {
    const nodeId = closestNode(event.target);
    if (nodeId && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); callbacks.current.onSelect(nodeId); return; }
    if (event.key === "Escape") { keys.clear(); stopGesture(); callbacks.current.onClear(); return; }
    if (event.target !== svg) return;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Shift"].includes(event.key)) {
      event.preventDefault(); fitted = true;
      if (reducedMotion) {
        camera.x += event.key === "ArrowLeft" ? 45 : event.key === "ArrowRight" ? -45 : 0;
        camera.y += event.key === "ArrowUp" ? 45 : event.key === "ArrowDown" ? -45 : 0;
      } else keys.add(event.key);
      wake();
    } else if (event.key === "+" || event.key === "=") { event.preventDefault(); changeZoom(1.5); }
    else if (event.key === "-") { event.preventDefault(); changeZoom(1 / 1.5); }
    else if (event.key === "0") { event.preventDefault(); fit(); }
  };
  const keyUp = event => { keys.delete(event.key); wake(); };
  const focusIn = event => { focusId = closestNode(event.target); wake(); };
  const focusOut = event => { focusId = closestNode(event.relatedTarget); keys.clear(); wake(); };
  const blur = () => { keys.clear(); hoverId = focusId = null; stopGesture(); };
  const motionChange = () => { reducedMotion = media.matches; velocityX = velocityY = 0; transport.setReducedMotion(reducedMotion); wake(); };
  const resize = new ResizeObserver(entries => {
    const rectangle = entries[0].contentRect; if (rectangle.width <= 0 || rectangle.height <= 0) return;
    camera.x += (rectangle.width - width) / 2; camera.y += (rectangle.height - height) / 2;
    camera.anchorX += (rectangle.width - width) / 2; camera.anchorY += (rectangle.height - height) / 2;
    width = rectangle.width; height = rectangle.height;
    paint(svg, "viewBox", `0 0 ${width} ${height}`); wake();
  });
  const theme = new MutationObserver(readColors);
  const events = { pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerUp, pointercancel: pointerCancel, lostpointercapture: lostCapture, pointerover: pointerOver, pointerout: pointerOut, click, keydown: keyDown, keyup: keyUp, focusin: focusIn, focusout: focusOut };
  Object.entries(events).forEach(([name, listener]) => svg.addEventListener(name, listener));
  svg.addEventListener("wheel", wheel, { passive: false }); window.addEventListener("blur", blur); window.addEventListener("keyup", keyUp);
  media.addEventListener("change", motionChange); resize.observe(container);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-interface-theme", "data-color-scheme", "class", "style"] });
  if (document.body) theme.observe(document.body, { attributes: true, attributeFilter: ["data-theme", "class"] });
  paint(svg, "viewBox", `0 0 ${width} ${height}`); readColors();
  return {
    setGraph(next) {
      graph = next;
      const previous = nodeElements;
      nodeElements = new Map([...svg.querySelectorAll(".ik-node")].map(group => {
        const id = group.getAttribute("data-node-id");
        return [id, { group, dot: group.querySelector(".ik-node-dot"), ring: group.querySelector(".ik-node-ring"), target: group.querySelector(".ik-node-target"), text: group.querySelector("text"), alpha: previous.get(id)?.alpha ?? 1, move: previous.get(id)?.move ?? 0, color: previous.get(id)?.color ?? [...(
          graph.byId.get(id)?.kind === "company" ? colors.company
            : graph.byId.get(id)?.kind === "role" ? colors.role
            : colors.node
        )] }];
      }));
      const previousEdges = new Map(edgeElements.map(visual => [visual.line, visual]));
      edgeElements = [...svg.querySelectorAll(".ik-edges line")].map((line, index) => ({ line, edge: next.edges[index], alpha: previousEdges.get(line)?.alpha ?? 1, color: previousEdges.get(line)?.color ?? [...colors.edge] }));
      if (gesture?.nodeId && !graph.byId.has(gesture.nodeId)) stopGesture();
      if (hoverId && !graph.byId.has(hoverId)) hoverId = null;
      if (focusId && !graph.byId.has(focusId)) focusId = null;
      if (selectedNodeId && !graph.byId.has(selectedNodeId)) selectedNodeId = null;
      transport.setGraph(next.nodes, next.edges); wake();
    },
    setHighlighted(ids) { highlighted = ids; wake(); },
    setSelected(id) { selectedNodeId = id; wake(); },
    changeZoom, fit,
    destroy() {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      gesture = null; pendingPin = null; const captured = [...pointers.keys()]; pointers.clear(); captured.forEach(releaseCapture);
      transport.destroy(); resize.disconnect(); theme.disconnect();
      Object.entries(events).forEach(([name, listener]) => svg.removeEventListener(name, listener));
      svg.removeEventListener("wheel", wheel); window.removeEventListener("blur", blur); window.removeEventListener("keyup", keyUp);
      media.removeEventListener("change", motionChange);
    },
  };
}

export function InterviewKnowledgeGraph({ nodes, edges, selectedId, highlightedIds, onSelect, onClear, loading, error, onRetry }) {
  const canvasRef = useRef(null), svgRef = useRef(null), sceneRef = useRef(null), controllerRef = useRef(null);
  const callbacks = useRef({ onSelect, onClear });
  useEffect(() => { callbacks.current = { onSelect, onClear }; }, [onSelect, onClear]);
  const graph = useMemo(() => {
    const neighbors = new Map(nodes.map(node => [node.id, new Set([node.id])]));
    const validEdges = edges.filter(edge => neighbors.has(edge.source) && neighbors.has(edge.target));
    validEdges.forEach(edge => { neighbors.get(edge.source).add(edge.target); neighbors.get(edge.target).add(edge.source); });
    const roleCounts = new Map();
    nodes.filter(node => node.kind === "role").forEach(node => { const key = `${node.company}:${node.label}`; roleCounts.set(key, (roleCounts.get(key) || 0) + 1); });
    const prepared = nodes.map(node => {
      const degree = neighbors.get(node.id).size; // includes self
      const radius = node.kind === "company"
        ? Math.max(14, Math.min(5 * Math.sqrt(degree), 38))
        : node.kind === "role"
        ? Math.max(9, Math.min(3.5 * Math.sqrt(degree), 26))
        : Math.max(4, Math.min(2 * Math.sqrt(degree), 14));
      const label = node.kind === "role" && roleCounts.get(`${node.company}:${node.label}`) > 1 ? `${node.label} · ${node.businessUnit || "未指定事业部"}` : node.label;
      const fontSize = node.kind === "company" ? 15
        : node.kind === "role" ? 13
        : 11;
      return { ...node, radius, label, fontSize, lines: wrapGraphLabel(label, fontSize) };
    });
    return { nodes: prepared, edges: validEdges, neighbors, byId: new Map(prepared.map(node => [node.id, node])) };
  }, [nodes, edges]);
  useEffect(() => {
    const controller = createGraphController(canvasRef.current, svgRef.current, sceneRef.current, callbacks); controllerRef.current = controller;
    return () => { controller.destroy(); controllerRef.current = null; };
  }, []);
  useEffect(() => { controllerRef.current?.setGraph(graph); }, [graph]);
  useEffect(() => { controllerRef.current?.setHighlighted(highlightedIds); }, [highlightedIds]);
  useEffect(() => { controllerRef.current?.setSelected(selectedId); }, [selectedId]);
  return <div className="ik-canvas" ref={canvasRef}>
    <svg ref={svgRef} className="ik-graph" role="group" aria-label="面试知识图谱" tabIndex={0} viewBox="0 0 900 640">
      <g ref={sceneRef} transform="translate(450 320) scale(1)">
        <g className="ik-edges" aria-hidden="true">{graph.edges.map((edge, index) => <line key={edge.id || `${edge.source}:${edge.target}:${index}`} data-source={edge.source} data-target={edge.target} />)}</g>
        {graph.nodes.map(node => <g key={node.id} visibility="hidden" data-node-id={node.id} data-degree={graph.neighbors.get(node.id).size - 1} className={`ik-node ik-node-${node.kind}${selectedId === node.id ? " is-selected" : ""}${highlightedIds?.has(node.id) ? " is-match" : ""}`} role="button" tabIndex={0} aria-label={`${{ company: "公司", role: "岗位", source: "面经" }[node.kind]}：${node.label}`} aria-pressed={selectedId === node.id}>
          <title>{node.label}</title>
          <circle className="ik-node-target" r={node.radius + 2} />
          <circle className="ik-node-ring" r={node.radius + 1} />
          <circle className="ik-node-dot" r={node.radius} />
          <text textAnchor="middle" dominantBaseline="hanging" style={{ fontSize: node.fontSize }} aria-hidden="true">{node.lines.map((line, index) => <tspan key={index} x="0" dy={index ? "1.2em" : "0"}>{line}</tspan>)}</text>
        </g>)}
      </g>
    </svg>
    {loading && <div className="ik-canvas-status" role="status">正在读取…</div>}
    {!loading && !nodes.length && <div className="ik-canvas-empty"><div className="ik-empty-card"><strong>{error ? "暂时无法读取面试知识" : "还没有保存面经"}</strong>{error ? <button type="button" onClick={onRetry}>重试</button> : <p>在岗位的“面试”页开始调研。</p>}</div></div>}
    {!!nodes.length && <div className="ik-graph-controls" aria-label="图谱视图控制">
      <button type="button" onClick={() => controllerRef.current?.changeZoom(1.5)} aria-label="放大图谱" title="放大"><Plus size={15} /></button>
      <span aria-live="off" aria-label="当前缩放比例">100%</span>
      <button type="button" onClick={() => controllerRef.current?.changeZoom(1 / 1.5)} aria-label="缩小图谱" title="缩小"><Minus size={15} /></button>
      <i />
      <button type="button" onClick={() => controllerRef.current?.fit()} aria-label="适应图谱" title="适应图谱"><Maximize2 size={14} /></button>
    </div>}
  </div>;
}
