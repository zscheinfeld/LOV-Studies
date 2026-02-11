// ========== Global State ==========
let mySound;
let amp;
let fft;
let canvWidth;
let canvHeight;
let durationInSeconds;
let isPlaying = 1; // 1 = paused, -1 = playing

// Brush stamp PNGs (optional)
let brushStamps = [];
let usePNGBrushes = false;

// ========== Stroke State ==========
let strokes = [];
let activeStroke = null;
let strokeIdCounter = 0;
let hoveredStroke = null;

// ========== Speech Detection ==========
let isSpeaking = false;
let silenceTimer = 0;
const SPEECH_ONSET_THRESHOLD = 0.015;
const SPEECH_OFFSET_THRESHOLD = 0.008;
const SILENCE_HOLD_FRAMES = 12; // ~200ms at 60fps
const MIN_STROKE_POINTS = 5;

// ========== Stroke Path Config (mutable via controls) ==========
let cfgNoiseScale = 0.015;
let cfgWanderRange = 3.0;
const EDGE_MARGIN = 0.05;
const EDGE_PULL_ZONE = 0.1;
const EDGE_PULL_STRENGTH = 0.3;

// ========== Brush Texture Config (mutable via controls) ==========
let cfgBristleCount = 3;
let cfgBristleSpread = 1.5;
let cfgWidthMult = 1.0;
let cfgOpacityMult = 1.0;
let cfgTextureType = 'bristle'; // bristle | smooth | rough | dotted

// ========== Color Config ==========
let cfgBgColor = '#ffffff';
let cfgStrokeColors = ['#000000']; // array of hex colors, strokes cycle through
let strokeColorIndex = 0; // which color the next stroke will use

// ========== Layout Mode Config ==========
let cfgLayoutMode = 'random'; // random | linear | circular
let cfgSegmentSpacing = 30; // pixels between segments

// Linear mode state — vertical lines from bottom up, shifting right
let linearCursorX = 40;
const LINEAR_SPEED = 2; // pixels upward per frame
const LINEAR_MARGIN = 30; // top/bottom canvas margin

// Circular mode state — spiral from center outward
let spiralAngle = 0;
let spiralRadius = 5;
let cfgSpiralSpeed = 0.06; // radians per frame (mutable via slider)

// ========== Scrubber State ==========
let scrubberDragging = false;

// ========== Memory Management ==========
const MAX_STROKE_BUFFERS = 100;

// ========== Hover Color ==========
const CORAL = [196, 69, 54]; // #C44536

// ========== Utilities ==========
function formatTime(sec) {
  if (!isFinite(sec) || isNaN(sec)) return '0:00';
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + (s < 10 ? '0' + s : s);
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(px, py, x1, y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return dist(px, py, projX, projY);
}

// ========== Play Toggle ==========
function play() {
  isPlaying = isPlaying * -1;
  if (isPlaying == -1) {
    if (mySound && typeof mySound.play === 'function') mySound.play();
    $("#play").text("Pause");
  } else {
    if (mySound && typeof mySound.pause === 'function') mySound.pause();
    $("#play").text("Play");
  }
}

// ========== p5.js Lifecycle ==========
function preload() {
  mySound = loadSound('sample.mp3');

  // Attempt to load optional PNG brush stamps
  const brushFiles = [
    'Brushes/brush_01.png',
    'Brushes/brush_02.png',
    'Brushes/brush_03.png'
  ];
  for (let i = 0; i < brushFiles.length; i++) {
    loadImage(
      brushFiles[i],
      function(img) {
        brushStamps.push(img);
        usePNGBrushes = true;
      },
      function() {
        // Not found — that's fine, use programmatic brushes
      }
    );
  }
}

function setup() {
  canvWidth = canvWidth || $("#my-p5-container").width() || 600;
  canvHeight = canvHeight || $("#my-p5-container").height() || 600;

  let myCanvas = createCanvas(canvWidth, canvHeight);
  myCanvas.parent('my-p5-container');

  amp = new p5.Amplitude();
  fft = new p5.FFT(0.8, 1024);
  durationInSeconds = mySound.duration();

  textFont('pitch');
  background(255);

  // Initialize layout mode state
  linearCursorX = LINEAR_MARGIN;
  spiralAngle = 0;
  spiralRadius = 5;

  // Set scrubber duration label
  const scrubberDuration = document.getElementById('scrubber-duration');
  if (scrubberDuration) scrubberDuration.textContent = formatTime(durationInSeconds);
}

function draw() {
  // Use configurable background color
  background(cfgBgColor);

  let currentTime = (mySound && typeof mySound.currentTime === 'function')
    ? mySound.currentTime() : 0;
  let level = amp.getLevel();

  // Speech detection — only while playing
  if (isPlaying === -1) {
    updateSpeechDetection(level);
  }

  // Render completed strokes
  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i];
    if (s === activeStroke) continue;

    if (s === hoveredStroke) {
      // Draw coral version
      if (s.coralGraphic) {
        image(s.coralGraphic, s.graphicOffsetX, s.graphicOffsetY);
      } else if (s.graphic) {
        // Lazily create coral version
        s.coralGraphic = createCoralGraphic(s);
        image(s.coralGraphic, s.graphicOffsetX, s.graphicOffsetY);
      }
    } else if (s.graphic) {
      image(s.graphic, s.graphicOffsetX, s.graphicOffsetY);
    }
  }

  // Render active (growing) stroke directly
  if (activeStroke && activeStroke.points.length >= 2) {
    const sc = activeStroke.strokeColor || '#000000';
    renderStrokeDirectly(activeStroke, color(sc));
  }

  // Hover tooltip
  if (hoveredStroke) {
    drawTooltip(mouseX, mouseY, hoveredStroke);
  }

  // Playback time in bottom-left (auto contrast based on bg brightness)
  noStroke();
  const bgC = color(cfgBgColor);
  const bgBright = (red(bgC) * 299 + green(bgC) * 587 + blue(bgC) * 114) / 1000;
  fill(bgBright > 128 ? 160 : 200);
  textFont('pitch');
  textSize(11);
  textAlign(LEFT, BOTTOM);
  text(formatTime(currentTime) + ' / ' + formatTime(durationInSeconds), 8, canvHeight - 8);

  // Update time scrubber (unless user is dragging it)
  if (!scrubberDragging) {
    const scrubberRange = document.getElementById('scrubber-range');
    const scrubberCurrent = document.getElementById('scrubber-current');
    if (scrubberRange) {
      scrubberRange.max = durationInSeconds || 1;
      scrubberRange.value = currentTime;
    }
    if (scrubberCurrent) scrubberCurrent.textContent = formatTime(currentTime);
  }

  // Update audio data panel
  updateAudioDataPanel(level);
}

// ========== Speech Detection ==========
function updateSpeechDetection(level) {
  if (!isSpeaking) {
    if (level >= SPEECH_ONSET_THRESHOLD) {
      isSpeaking = true;
      silenceTimer = 0;
      beginNewStroke();
      updateSpeechIndicator(true);
    }
  } else {
    if (level < SPEECH_OFFSET_THRESHOLD) {
      silenceTimer++;
      if (silenceTimer >= SILENCE_HOLD_FRAMES) {
        isSpeaking = false;
        silenceTimer = 0;
        endCurrentStroke();
        updateSpeechIndicator(false);
      }
    } else {
      silenceTimer = 0;
    }
    if (isSpeaking && activeStroke) {
      extendActiveStroke(level);
    }
  }
}

function updateSpeechIndicator(speaking) {
  const el = document.getElementById('data-speech');
  if (el) el.textContent = speaking ? 'Speaking' : 'Silent';
}

// ========== Stroke Lifecycle ==========
function beginNewStroke() {
  const currentTime = mySound.currentTime();
  const marginX = canvWidth * EDGE_MARGIN;
  const marginY = canvHeight * EDGE_MARGIN;

  // Determine origin based on layout mode
  let ox, oy;
  if (cfgLayoutMode === 'linear') {
    ox = linearCursorX;
    oy = random(canvHeight * 0.3, canvHeight - LINEAR_MARGIN);
  } else if (cfgLayoutMode === 'circular') {
    const cx = canvWidth / 2;
    const cy = canvHeight / 2;
    ox = cx + spiralRadius * Math.cos(spiralAngle);
    oy = cy + spiralRadius * Math.sin(spiralAngle);
  } else {
    ox = random(marginX, canvWidth - marginX);
    oy = random(marginY, canvHeight - marginY);
  }

  activeStroke = {
    id: strokeIdCounter++,
    startTime: currentTime,
    endTime: currentTime,
    originX: ox,
    originY: oy,
    noiseSeedX: random(0, 10000),
    noiseSeedY: random(0, 10000),
    points: [],
    boundingBox: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    graphic: null,
    coralGraphic: null,
    graphicOffsetX: 0,
    graphicOffsetY: 0,
    dirty: true,
    // Capture current control settings for this stroke
    layoutMode: cfgLayoutMode,
    textureType: cfgTextureType,
    bristleCount: cfgBristleCount,
    bristleSpread: cfgBristleSpread,
    strokeColor: cfgStrokeColors[strokeColorIndex % cfgStrokeColors.length] || '#000000'
  };
  strokes.push(activeStroke);
}

function extendActiveStroke(level) {
  const s = activeStroke;
  const t = s.points.length;
  const currentTime = mySound.currentTime();
  s.endTime = currentTime;

  // Calculate position based on layout mode
  let px, py;
  const mode = s.layoutMode || 'random';

  if (mode === 'linear') {
    // Straight vertical line from bottom upward
    if (t === 0) {
      px = s.originX;
      py = s.originY;
    } else {
      const prev = s.points[t - 1];
      px = s.originX; // stay on same x column
      py = prev.y - LINEAR_SPEED;
    }
    px = constrain(px, 10, canvWidth - 10);
    py = constrain(py, LINEAR_MARGIN, canvHeight - 10);

  } else if (mode === 'circular') {
    // Spiral from center outward
    const cx = canvWidth / 2;
    const cy = canvHeight / 2;
    if (t === 0) {
      px = s.originX;
      py = s.originY;
    } else {
      // Advance spiral
      spiralAngle += cfgSpiralSpeed;
      // Radius grows so that each revolution adds cfgSegmentSpacing to the radius
      spiralRadius += cfgSpiralSpeed * cfgSegmentSpacing / (2 * Math.PI);
      px = cx + spiralRadius * Math.cos(spiralAngle);
      py = cy + spiralRadius * Math.sin(spiralAngle);
    }
    px = constrain(px, 10, canvWidth - 10);
    py = constrain(py, 10, canvHeight - 10);

  } else {
    // Random — Perlin noise wandering
    if (t === 0) {
      px = s.originX;
      py = s.originY;
    } else {
      const prev = s.points[t - 1];
      const dx = (noise(s.noiseSeedX + t * cfgNoiseScale) - 0.5) * 2 * cfgWanderRange;
      const dy = (noise(s.noiseSeedY + t * cfgNoiseScale) - 0.5) * 2 * cfgWanderRange;
      px = prev.x + dx;
      py = prev.y + dy;

      // Gentle edge pull
      const pullZoneX = canvWidth * EDGE_PULL_ZONE;
      const pullZoneY = canvHeight * EDGE_PULL_ZONE;
      if (px < pullZoneX) px += (pullZoneX - px) * EDGE_PULL_STRENGTH;
      if (px > canvWidth - pullZoneX) px -= (px - (canvWidth - pullZoneX)) * EDGE_PULL_STRENGTH;
      if (py < pullZoneY) py += (pullZoneY - py) * EDGE_PULL_STRENGTH;
      if (py > canvHeight - pullZoneY) py -= (py - (canvHeight - pullZoneY)) * EDGE_PULL_STRENGTH;
    }
    px = constrain(px, 10, canvWidth - 10);
    py = constrain(py, 10, canvHeight - 10);
  }

  // Map amplitude to width and opacity (scaled by user controls)
  const strokeWidth = map(level, 0, 0.3, 2, 22) * cfgWidthMult;
  const strokeOpacity = constrain(map(level, 0, 0.3, 60, 240) * cfgOpacityMult, 0, 255);

  const point = {
    x: px,
    y: py,
    width: strokeWidth,
    opacity: strokeOpacity,
    time: currentTime
  };

  s.points.push(point);

  // Update bounding box — margin must account for bristle offsets + stroke weight
  let margin;
  const texType = s.textureType || 'bristle';
  if (texType === 'bristle' || texType === 'rough') {
    const bc = s.bristleCount || 3;
    const bs = s.bristleSpread || 1.5;
    const maxBristleOffset = (bc - 1) / 2 * bs;
    const bristleWeight = strokeWidth * (0.5 + 0.5 / bc) / 2;
    margin = maxBristleOffset + bristleWeight + 4;
  } else if (texType === 'dotted') {
    margin = strokeWidth * 0.35 + 4;
  } else {
    margin = strokeWidth / 2 + 4;
  }
  s.boundingBox.minX = Math.min(s.boundingBox.minX, px - margin);
  s.boundingBox.minY = Math.min(s.boundingBox.minY, py - margin);
  s.boundingBox.maxX = Math.max(s.boundingBox.maxX, px + margin);
  s.boundingBox.maxY = Math.max(s.boundingBox.maxY, py + margin);

  s.dirty = true;
}

function endCurrentStroke() {
  if (!activeStroke) return;

  if (activeStroke.points.length < MIN_STROKE_POINTS) {
    // Too short, discard
    strokes.pop();
  } else {
    // Render to offscreen buffer for performance
    renderStrokeToGraphic(activeStroke);
    activeStroke.dirty = false;
    // Advance color index for next stroke
    strokeColorIndex++;

    // Advance layout cursors and save state for rewind
    if (activeStroke.layoutMode === 'linear') {
      linearCursorX += cfgSegmentSpacing;
      if (linearCursorX > canvWidth - LINEAR_MARGIN) {
        linearCursorX = LINEAR_MARGIN; // wrap to left
      }
    }
    // Save layout continuation state on the stroke
    activeStroke.savedLinearX = linearCursorX;
    activeStroke.savedSpiralAngle = spiralAngle;
    activeStroke.savedSpiralRadius = spiralRadius;
  }
  activeStroke = null;

  // Memory management: free oldest buffers if too many
  if (strokes.length > MAX_STROKE_BUFFERS) {
    const old = strokes[0];
    if (old && old.graphic) {
      old.graphic.remove();
      old.graphic = null;
    }
    if (old && old.coralGraphic) {
      old.coralGraphic.remove();
      old.coralGraphic = null;
    }
  }
}

// ========== Stroke Rendering ==========
function renderStrokeToGraphic(s) {
  const bb = s.boundingBox;
  const w = Math.ceil(bb.maxX - bb.minX) + 4;
  const h = Math.ceil(bb.maxY - bb.minY) + 4;

  if (w < 4 || h < 4) return;

  const g = createGraphics(w, h);
  g.clear();

  const sc = s.strokeColor || '#000000';
  renderStrokeToTarget(g, s, -bb.minX + 2, -bb.minY + 2, g.color(sc));

  s.graphic = g;
  s.graphicOffsetX = bb.minX - 2;
  s.graphicOffsetY = bb.minY - 2;
}

function createCoralGraphic(s) {
  const bb = s.boundingBox;
  const w = Math.ceil(bb.maxX - bb.minX) + 4;
  const h = Math.ceil(bb.maxY - bb.minY) + 4;

  if (w < 4 || h < 4) return null;

  const g = createGraphics(w, h);
  g.clear();

  renderStrokeToTarget(g, s, -bb.minX + 2, -bb.minY + 2, g.color(CORAL[0], CORAL[1], CORAL[2]));

  return g;
}

function renderStrokeToTarget(target, s, offsetX, offsetY, strokeColor) {
  if (usePNGBrushes && brushStamps.length > 0) {
    renderStrokeWithStamps(target, s, offsetX, offsetY, strokeColor);
    return;
  }
  // Use the texture type stored on the stroke (captured at creation time)
  const texType = s.textureType || 'bristle';
  switch (texType) {
    case 'smooth':
      renderStrokeSmooth(target, s, offsetX, offsetY, strokeColor);
      break;
    case 'rough':
      renderStrokeBristles(target, s, offsetX, offsetY, strokeColor, s.bristleCount || 7, s.bristleSpread || 3.5);
      break;
    case 'dotted':
      renderStrokeDotted(target, s, offsetX, offsetY, strokeColor);
      break;
    case 'bristle':
    default:
      renderStrokeBristles(target, s, offsetX, offsetY, strokeColor, s.bristleCount || 3, s.bristleSpread || 1.5);
      break;
  }
}

// Multi-bristle brush rendering (used for bristle + rough)
function renderStrokeBristles(target, s, offsetX, offsetY, strokeColor, bristleCount, bristleSpread) {
  const pts = s.points;
  if (pts.length < 2) return;

  const r = red(strokeColor);
  const g = green(strokeColor);
  const b = blue(strokeColor);

  for (let bristle = 0; bristle < bristleCount; bristle++) {
    const bristleOffset = (bristle - (bristleCount - 1) / 2) * bristleSpread;
    const opacityMult = bristle === Math.floor(bristleCount / 2) ? 1.0 : 0.4;

    target.noFill();
    target.strokeCap(ROUND);
    target.strokeJoin(ROUND);

    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];

      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const perpX = -dy / len * bristleOffset;
      const perpY = dx / len * bristleOffset;

      target.stroke(r, g, b, curr.opacity * opacityMult);
      target.strokeWeight(curr.width * (0.5 + 0.5 / bristleCount));

      target.line(
        prev.x + offsetX + perpX,
        prev.y + offsetY + perpY,
        curr.x + offsetX + perpX,
        curr.y + offsetY + perpY
      );
    }
  }
}

// Smooth single-line rendering
function renderStrokeSmooth(target, s, offsetX, offsetY, strokeColor) {
  const pts = s.points;
  if (pts.length < 2) return;

  const r = red(strokeColor);
  const g = green(strokeColor);
  const b = blue(strokeColor);

  target.noFill();
  target.strokeCap(ROUND);
  target.strokeJoin(ROUND);

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    target.stroke(r, g, b, curr.opacity);
    target.strokeWeight(curr.width);
    target.line(prev.x + offsetX, prev.y + offsetY, curr.x + offsetX, curr.y + offsetY);
  }
}

// Dotted rendering — circles along the path
function renderStrokeDotted(target, s, offsetX, offsetY, strokeColor) {
  const pts = s.points;
  if (pts.length < 2) return;

  const r = red(strokeColor);
  const g = green(strokeColor);
  const b = blue(strokeColor);

  target.noStroke();

  const DOT_SPACING = 6;
  let distAccum = 0;

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const segDist = dist(prev.x, prev.y, curr.x, curr.y);
    distAccum += segDist;

    if (distAccum >= DOT_SPACING) {
      distAccum -= DOT_SPACING;
      target.fill(r, g, b, curr.opacity);
      target.ellipse(curr.x + offsetX, curr.y + offsetY, curr.width * 0.7, curr.width * 0.7);
    }
  }
}

// PNG stamp-based rendering
function renderStrokeWithStamps(target, s, offsetX, offsetY, strokeColor) {
  const pts = s.points;
  if (pts.length < 2 || brushStamps.length === 0) return;

  const r = red(strokeColor);
  const g = green(strokeColor);
  const b = blue(strokeColor);

  target.imageMode(CENTER);

  const STAMP_SPACING = 8;
  let distAccum = 0;

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const segDist = dist(prev.x, prev.y, curr.x, curr.y);
    distAccum += segDist;

    if (distAccum >= STAMP_SPACING) {
      distAccum -= STAMP_SPACING;

      const stamp = brushStamps[i % brushStamps.length];
      const angle = Math.atan2(curr.y - prev.y, curr.x - prev.x);
      const stampSize = curr.width * 1.5;

      target.push();
      target.translate(curr.x + offsetX, curr.y + offsetY);
      target.rotate(angle);
      target.tint(r, g, b, curr.opacity);
      target.image(stamp, 0, 0, stampSize, stampSize);
      target.pop();
    }
  }

  target.noTint();
  target.imageMode(CORNER);
}

// Render stroke directly to main canvas (for active stroke)
// Uses a thin wrapper that delegates to the same rendering functions
// but targets the main canvas (p5 global drawing context)
function renderStrokeDirectly(s, strokeColor) {
  if (usePNGBrushes && brushStamps.length > 0) {
    renderStrokeWithStamps(window, s, 0, 0, strokeColor);
    return;
  }
  const texType = s.textureType || 'bristle';
  switch (texType) {
    case 'smooth':
      renderStrokeSmoothDirect(s, strokeColor);
      break;
    case 'rough':
      renderStrokeBristlesDirect(s, strokeColor, s.bristleCount || 7, s.bristleSpread || 3.5);
      break;
    case 'dotted':
      renderStrokeDottedDirect(s, strokeColor);
      break;
    case 'bristle':
    default:
      renderStrokeBristlesDirect(s, strokeColor, s.bristleCount || 3, s.bristleSpread || 1.5);
      break;
  }
}

function renderStrokeBristlesDirect(s, strokeColor, bristleCount, bristleSpread) {
  const pts = s.points;
  if (pts.length < 2) return;

  const r = red(strokeColor);
  const g = green(strokeColor);
  const b = blue(strokeColor);

  for (let bst = 0; bst < bristleCount; bst++) {
    const bstOffset = (bst - (bristleCount - 1) / 2) * bristleSpread;
    const opacityMult = bst === Math.floor(bristleCount / 2) ? 1.0 : 0.4;

    noFill();
    strokeCap(ROUND);
    strokeJoin(ROUND);

    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];

      const dx = curr.x - prev.x;
      const dy = curr.y - prev.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const perpX = -dy / len * bstOffset;
      const perpY = dx / len * bstOffset;

      stroke(r, g, b, curr.opacity * opacityMult);
      strokeWeight(curr.width * (0.5 + 0.5 / bristleCount));

      line(prev.x + perpX, prev.y + perpY, curr.x + perpX, curr.y + perpY);
    }
  }
}

function renderStrokeSmoothDirect(s, strokeColor) {
  const pts = s.points;
  if (pts.length < 2) return;
  const r = red(strokeColor);
  const g = green(strokeColor);
  const b = blue(strokeColor);

  noFill();
  strokeCap(ROUND);
  strokeJoin(ROUND);
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    stroke(r, g, b, curr.opacity);
    strokeWeight(curr.width);
    line(prev.x, prev.y, curr.x, curr.y);
  }
}

function renderStrokeDottedDirect(s, strokeColor) {
  const pts = s.points;
  if (pts.length < 2) return;
  const r = red(strokeColor);
  const g = green(strokeColor);
  const b = blue(strokeColor);

  noStroke();
  const DOT_SPACING = 6;
  let distAccum = 0;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const segDist = dist(prev.x, prev.y, curr.x, curr.y);
    distAccum += segDist;
    if (distAccum >= DOT_SPACING) {
      distAccum -= DOT_SPACING;
      fill(r, g, b, curr.opacity);
      ellipse(curr.x, curr.y, curr.width * 0.7, curr.width * 0.7);
    }
  }
}

// ========== Hover Detection ==========
function mouseMoved() {
  hoveredStroke = null;
  const mx = mouseX;
  const my = mouseY;

  // Only detect hover when mouse is over the canvas
  if (mx < 0 || mx > canvWidth || my < 0 || my > canvHeight) return;

  // Search reverse (newest first)
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    if (s === activeStroke) continue;
    if (!s.graphic) continue;

    const bb = s.boundingBox;
    const margin = 8;

    // Bounding box rejection
    if (mx < bb.minX - margin || mx > bb.maxX + margin ||
        my < bb.minY - margin || my > bb.maxY + margin) {
      continue;
    }

    // Point proximity check
    if (isNearStrokePath(s, mx, my, margin)) {
      hoveredStroke = s;
      break;
    }
  }

  // Update cursor
  const container = document.getElementById('my-p5-container');
  if (container) {
    container.style.cursor = hoveredStroke ? 'pointer' : 'default';
  }

  // Show/hide scrubber in fullscreen when mouse near bottom
  if (document.fullscreenElement) {
    const scrubber = document.getElementById('time-scrubber');
    if (scrubber) {
      const nearBottom = my > canvHeight * 0.85;
      scrubber.classList.toggle('scrubber-visible', nearBottom);
    }
  }
}

function isNearStrokePath(s, mx, my, tolerance) {
  const pts = s.points;
  const skip = Math.max(1, Math.floor(pts.length / 100));

  for (let i = 0; i < pts.length - 1; i += skip) {
    const p = pts[i];
    const q = pts[Math.min(i + skip, pts.length - 1)];
    const d = distToSegment(mx, my, p.x, p.y, q.x, q.y);
    const effectiveTolerance = tolerance + (p.width + q.width) / 4;
    if (d < effectiveTolerance) return true;
  }
  return false;
}

// ========== Tooltip ==========
function drawTooltip(mx, my, s) {
  const label = formatTime(s.startTime) + ' - ' + formatTime(s.endTime);

  textFont('pitch');
  textSize(12);
  const tw = textWidth(label);
  const padding = 6;
  const boxW = tw + padding * 2;
  const boxH = 20 + padding;

  let tx = mx + 14;
  let ty = my - 30;
  if (ty < 0) ty = my + 20;
  if (tx + boxW > canvWidth) tx = mx - boxW - 8;

  noStroke();
  fill(0, 0, 0, 180);
  rect(tx, ty, boxW, boxH, 3);

  fill(255);
  textAlign(LEFT, TOP);
  text(label, tx + padding, ty + padding - 1);
}

// ========== Audio Data Panel ==========
function updateAudioDataPanel(level) {
  // Amplitude
  const ampEl = document.getElementById('data-amplitude');
  const ampBar = document.getElementById('bar-amplitude');
  if (ampEl) ampEl.textContent = level.toFixed(3);
  if (ampBar) ampBar.style.width = Math.min(100, level / 0.3 * 100) + '%';

  // Volume in dB
  const volEl = document.getElementById('data-volume');
  const volBar = document.getElementById('bar-volume');
  const dB = level > 0 ? 20 * Math.log10(level) : -Infinity;
  if (volEl) volEl.textContent = isFinite(dB) ? dB.toFixed(1) + ' dB' : '-Inf dB';
  if (volBar) volBar.style.width = Math.min(100, Math.max(0, (dB + 60) / 60 * 100)) + '%';

  // FFT analysis
  const spectrum = fft.analyze();
  const nyq = sampleRate() / 2;

  // Dominant frequency
  let maxVal = 0;
  let maxBin = 0;
  for (let i = 1; i < spectrum.length; i++) {
    if (spectrum[i] > maxVal) {
      maxVal = spectrum[i];
      maxBin = i;
    }
  }
  const dominantFreq = maxBin * (nyq / spectrum.length);
  const freqEl = document.getElementById('data-frequency');
  const freqBar = document.getElementById('bar-frequency');
  if (freqEl) freqEl.textContent = Math.round(dominantFreq) + ' Hz';
  if (freqBar) freqBar.style.width = Math.min(100, dominantFreq / 4000 * 100) + '%';

  // Spectral centroid
  let weightedSum = 0;
  let totalEnergy = 0;
  for (let i = 0; i < spectrum.length; i++) {
    const freq = i * (nyq / spectrum.length);
    weightedSum += freq * spectrum[i];
    totalEnergy += spectrum[i];
  }
  const centroid = totalEnergy > 0 ? weightedSum / totalEnergy : 0;
  const centroidEl = document.getElementById('data-centroid');
  const centroidBar = document.getElementById('bar-centroid');
  if (centroidEl) centroidEl.textContent = Math.round(centroid) + ' Hz';
  if (centroidBar) centroidBar.style.width = Math.min(100, centroid / 4000 * 100) + '%';

  // Bass energy (bins 0-10 ~ 0-215 Hz)
  let bassEnergy = 0;
  for (let i = 0; i < 10; i++) {
    bassEnergy += spectrum[i];
  }
  bassEnergy /= (10 * 255);
  const bassEl = document.getElementById('data-bass');
  const bassBar = document.getElementById('bar-bass');
  if (bassEl) bassEl.textContent = bassEnergy.toFixed(3);
  if (bassBar) bassBar.style.width = Math.min(100, bassEnergy * 100) + '%';
}

// ========== Window Resize ==========
function windowResized() {
  canvWidth = $("#my-p5-container").width();
  canvHeight = $("#my-p5-container").height();
  resizeCanvas(canvWidth, canvHeight);
  background(cfgBgColor);
}

// ========== Stroke Removal ==========
// Remove all strokes created after the given stroke (by index)
function removeStrokesAfter(targetStroke) {
  const idx = strokes.indexOf(targetStroke);
  if (idx === -1) return;

  // Free graphics buffers for strokes after this one
  for (let i = strokes.length - 1; i > idx; i--) {
    const s = strokes[i];
    if (s.graphic) { s.graphic.remove(); s.graphic = null; }
    if (s.coralGraphic) { s.coralGraphic.remove(); s.coralGraphic = null; }
  }
  // Truncate the array
  strokes.length = idx + 1;

  // Restore layout state from the last remaining stroke
  const last = strokes[strokes.length - 1];
  if (last) {
    if (last.savedLinearX !== undefined) linearCursorX = last.savedLinearX;
    if (last.savedSpiralAngle !== undefined) spiralAngle = last.savedSpiralAngle;
    if (last.savedSpiralRadius !== undefined) spiralRadius = last.savedSpiralRadius;
  } else {
    // No strokes left — reset to initial state
    linearCursorX = LINEAR_MARGIN;
    spiralAngle = 0;
    spiralRadius = 5;
  }

  // If active stroke was removed, clear it
  if (activeStroke && strokes.indexOf(activeStroke) === -1) {
    activeStroke = null;
    isSpeaking = false;
    silenceTimer = 0;
  }

  hoveredStroke = null;
}

// Remove all strokes whose startTime >= the given time
function removeStrokesAfterTime(time) {
  // Find the last stroke to keep (startTime < time)
  let keepIdx = -1;
  for (let i = 0; i < strokes.length; i++) {
    if (strokes[i].startTime < time) {
      keepIdx = i;
    } else {
      break;
    }
  }

  // Free graphics for removed strokes
  for (let i = strokes.length - 1; i > keepIdx; i--) {
    const s = strokes[i];
    if (s.graphic) { s.graphic.remove(); s.graphic = null; }
    if (s.coralGraphic) { s.coralGraphic.remove(); s.coralGraphic = null; }
  }
  strokes.length = keepIdx + 1;
  strokeColorIndex = strokes.length;

  // Restore layout state
  const last = strokes[strokes.length - 1];
  if (last) {
    if (last.savedLinearX !== undefined) linearCursorX = last.savedLinearX;
    if (last.savedSpiralAngle !== undefined) spiralAngle = last.savedSpiralAngle;
    if (last.savedSpiralRadius !== undefined) spiralRadius = last.savedSpiralRadius;
  } else {
    linearCursorX = LINEAR_MARGIN;
    spiralAngle = 0;
    spiralRadius = 5;
  }

  if (activeStroke && strokes.indexOf(activeStroke) === -1) {
    activeStroke = null;
    isSpeaking = false;
    silenceTimer = 0;
  }
  hoveredStroke = null;
}

// ========== jQuery Ready — Event Handlers ==========
$(document).ready(function() {
  canvWidth = $("#my-p5-container").width();
  canvHeight = $("#my-p5-container").height();

  // Play button
  $("#play").click(function() {
    play();
  });

  // Time scrubber
  const scrubberRange = document.getElementById('scrubber-range');
  const scrubberCurrent = document.getElementById('scrubber-current');
  if (scrubberRange) {
    scrubberRange.addEventListener('mousedown', function() { scrubberDragging = true; });
    scrubberRange.addEventListener('touchstart', function() { scrubberDragging = true; });

    scrubberRange.addEventListener('input', function() {
      const seekTime = parseFloat(this.value);
      if (scrubberCurrent) scrubberCurrent.textContent = formatTime(seekTime);
    });

    scrubberRange.addEventListener('change', function() {
      scrubberDragging = false;
      const seekTime = parseFloat(this.value);

      // Remove strokes created after the seek time
      removeStrokesAfterTime(seekTime);

      // Seek audio
      if (typeof mySound.jump === 'function') {
        try { mySound.jump(seekTime); } catch(err) {
          try { mySound.play(undefined, undefined, undefined, seekTime); } catch(e2) {}
        }
      } else {
        try { mySound.play(undefined, undefined, undefined, seekTime); } catch(err) {}
      }
    });
  }

  const container = document.getElementById('my-p5-container');

  // Click handler: seek to hovered stroke, remove later strokes, or toggle play
  if (container) {
    container.addEventListener('click', function(e) {
      // Don't handle clicks on overlay buttons, controls panel, or scrubber
      if (e.target.closest('.controls-overlay')) return;
      if (e.target.closest('#stroke-controls')) return;
      if (e.target.closest('#time-scrubber')) return;

      if (hoveredStroke) {
        // Save seek time and reset color index BEFORE removeStrokesAfter nulls hoveredStroke
        const seekTime = hoveredStroke.startTime;
        const clickedIdx = strokes.indexOf(hoveredStroke);

        // Remove all strokes after this one
        removeStrokesAfter(hoveredStroke);

        // Reset color index to match remaining stroke count
        strokeColorIndex = strokes.length;

        // Seek to this stroke's start time
        if (typeof mySound.jump === 'function') {
          try { mySound.jump(seekTime); } catch(err) {
            try { mySound.play(undefined, undefined, undefined, seekTime); } catch(e2) {}
          }
        } else {
          try { mySound.play(undefined, undefined, undefined, seekTime); } catch(err) {}
        }
        // Ensure playing
        if (isPlaying !== -1) {
          play();
        }
      } else {
        // Toggle play/pause
        play();
      }
    });
  }

  // ========== Stroke Controls Panel ==========
  const scToggle = document.getElementById('sc-toggle');
  const scHeader = document.querySelector('#stroke-controls .sc-header');
  const scBody = document.querySelector('#stroke-controls .sc-body');

  // Toggle panel open/collapsed
  if (scHeader) {
    scHeader.addEventListener('click', function(e) {
      e.stopPropagation();
      scBody.classList.toggle('collapsed');
    });
  }

  // Prevent clicks inside panel from propagating to canvas
  const scPanel = document.getElementById('stroke-controls');
  if (scPanel) {
    scPanel.addEventListener('click', function(e) { e.stopPropagation(); });
    scPanel.addEventListener('mousedown', function(e) { e.stopPropagation(); });
  }

  // Layout mode dropdown
  const ctrlLayout = document.getElementById('ctrl-layout-mode');
  const rowWander = document.getElementById('row-wander');
  const rowSpacing = document.getElementById('row-spacing');
  const rowSpiralSpeed = document.getElementById('row-spiral-speed');

  function updateLayoutVisibility() {
    if (cfgLayoutMode === 'random') {
      if (rowWander) rowWander.style.display = '';
      if (rowSpacing) rowSpacing.style.display = 'none';
      if (rowSpiralSpeed) rowSpiralSpeed.style.display = 'none';
    } else if (cfgLayoutMode === 'circular') {
      if (rowWander) rowWander.style.display = 'none';
      if (rowSpacing) rowSpacing.style.display = '';
      if (rowSpiralSpeed) rowSpiralSpeed.style.display = '';
    } else {
      // linear
      if (rowWander) rowWander.style.display = 'none';
      if (rowSpacing) rowSpacing.style.display = '';
      if (rowSpiralSpeed) rowSpiralSpeed.style.display = 'none';
    }
  }

  if (ctrlLayout) {
    ctrlLayout.addEventListener('change', function() {
      cfgLayoutMode = this.value;
      updateLayoutVisibility();
      // Reset layout cursors when switching modes
      linearCursorX = LINEAR_MARGIN;
      spiralAngle = 0;
      spiralRadius = 5;
    });
  }
  updateLayoutVisibility();

  // Spacing slider (for linear/circular modes)
  const ctrlSpacing = document.getElementById('ctrl-spacing');
  const valSpacing = document.getElementById('val-spacing');
  if (ctrlSpacing) {
    ctrlSpacing.addEventListener('input', function() {
      cfgSegmentSpacing = parseFloat(this.value);
      if (valSpacing) valSpacing.textContent = Math.round(cfgSegmentSpacing);
    });
  }

  // Spiral speed slider (circular mode only)
  const ctrlSpiralSpeed = document.getElementById('ctrl-spiral-speed');
  const valSpiralSpeed = document.getElementById('val-spiral-speed');
  if (ctrlSpiralSpeed) {
    ctrlSpiralSpeed.addEventListener('input', function() {
      cfgSpiralSpeed = parseFloat(this.value);
      if (valSpiralSpeed) valSpiralSpeed.textContent = cfgSpiralSpeed.toFixed(3);
    });
  }

  // Texture type dropdown
  const ctrlTexture = document.getElementById('ctrl-texture-type');
  if (ctrlTexture) {
    ctrlTexture.addEventListener('change', function() {
      cfgTextureType = this.value;
    });
  }

  // Width multiplier
  const ctrlWidth = document.getElementById('ctrl-width');
  const valWidth = document.getElementById('val-width');
  if (ctrlWidth) {
    ctrlWidth.addEventListener('input', function() {
      cfgWidthMult = parseFloat(this.value);
      if (valWidth) valWidth.textContent = cfgWidthMult.toFixed(1) + 'x';
    });
  }

  // Opacity multiplier
  const ctrlOpacity = document.getElementById('ctrl-opacity');
  const valOpacity = document.getElementById('val-opacity');
  if (ctrlOpacity) {
    ctrlOpacity.addEventListener('input', function() {
      cfgOpacityMult = parseFloat(this.value);
      if (valOpacity) valOpacity.textContent = cfgOpacityMult.toFixed(1) + 'x';
    });
  }

  // Smoothness (inverse of noise scale: higher = smoother)
  const ctrlSmooth = document.getElementById('ctrl-smoothness');
  const valSmooth = document.getElementById('val-smoothness');
  if (ctrlSmooth) {
    ctrlSmooth.addEventListener('input', function() {
      const v = parseFloat(this.value);
      // Map slider 1-10 → noise scale 0.04-0.005 (higher slider = smoother = lower noise)
      cfgNoiseScale = map(v, 1, 10, 0.04, 0.005);
      if (valSmooth) valSmooth.textContent = v.toFixed(1);
    });
  }

  // Wander range
  const ctrlWander = document.getElementById('ctrl-wander');
  const valWander = document.getElementById('val-wander');
  if (ctrlWander) {
    ctrlWander.addEventListener('input', function() {
      cfgWanderRange = parseFloat(this.value);
      if (valWander) valWander.textContent = cfgWanderRange.toFixed(1);
    });
  }

  // Bristle count
  const ctrlBristles = document.getElementById('ctrl-bristles');
  const valBristles = document.getElementById('val-bristles');
  if (ctrlBristles) {
    ctrlBristles.addEventListener('input', function() {
      cfgBristleCount = parseInt(this.value);
      if (valBristles) valBristles.textContent = cfgBristleCount;
    });
  }

  // Bristle spread
  const ctrlSpread = document.getElementById('ctrl-spread');
  const valSpread = document.getElementById('val-spread');
  if (ctrlSpread) {
    ctrlSpread.addEventListener('input', function() {
      cfgBristleSpread = parseFloat(this.value);
      if (valSpread) valSpread.textContent = cfgBristleSpread.toFixed(1);
    });
  }

  // Background color
  const ctrlBgColor = document.getElementById('ctrl-bg-color');
  if (ctrlBgColor) {
    ctrlBgColor.addEventListener('input', function() {
      cfgBgColor = this.value;
      // Also update the container background for areas outside the canvas
      const cont = document.getElementById('my-p5-container');
      if (cont) cont.style.background = cfgBgColor;
    });
  }

  // Stroke color list
  const colorList = document.getElementById('stroke-color-list');
  const addColorBtn = document.getElementById('add-stroke-color');

  function syncStrokeColors() {
    const swatches = colorList.querySelectorAll('.stroke-color-swatch');
    cfgStrokeColors = [];
    swatches.forEach(function(sw) {
      cfgStrokeColors.push(sw.value);
    });
    if (cfgStrokeColors.length === 0) cfgStrokeColors = ['#000000'];
  }

  function attachSwatchListeners(swatch) {
    swatch.addEventListener('input', syncStrokeColors);
    // Right-click to remove (if more than one)
    swatch.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      if (colorList.querySelectorAll('.stroke-color-swatch').length > 1) {
        swatch.remove();
        syncStrokeColors();
      }
    });
  }

  // Attach to initial swatch
  if (colorList) {
    colorList.querySelectorAll('.stroke-color-swatch').forEach(attachSwatchListeners);
  }

  if (addColorBtn && colorList) {
    addColorBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      const newSwatch = document.createElement('input');
      newSwatch.type = 'color';
      newSwatch.className = 'stroke-color-swatch';
      // Pick a distinct default color
      const defaults = ['#000000', '#C44536', '#2B6CB0', '#2D6A4F', '#7B2D8E', '#D4A017'];
      const idx = colorList.querySelectorAll('.stroke-color-swatch').length;
      newSwatch.value = defaults[idx % defaults.length] || '#000000';
      colorList.appendChild(newSwatch);
      attachSwatchListeners(newSwatch);
      syncStrokeColors();
    });
  }

  // Fullscreen toggle
  const fsBtn = document.getElementById('fullscreen-toggle');
  const fsIcon = fsBtn && fsBtn.querySelector('.material-icons');

  if (fsBtn) {
    fsBtn.addEventListener('click', async function(e) {
      e.stopPropagation();
      if (!document.fullscreenElement) {
        try { await container.requestFullscreen(); } catch(err) {
          console.warn('Failed to enter fullscreen:', err);
        }
      } else {
        try { await document.exitFullscreen(); } catch(err) {
          console.warn('Failed to exit fullscreen:', err);
        }
      }
    });

    document.addEventListener('fullscreenchange', function() {
      if (document.fullscreenElement === container) {
        fsIcon.textContent = 'fullscreen_exit';
        container.style.background = cfgBgColor;
        windowResized();
      } else {
        fsIcon.textContent = 'fullscreen';
        container.style.background = cfgBgColor;
        windowResized();
      }
    });
  }
});
