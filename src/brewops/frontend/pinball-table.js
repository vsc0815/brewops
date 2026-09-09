// Coffee Flipper — pinball table data and pure geometry helpers.
// No DOM, no canvas, no game state: just constants and side-effect-free math,
// kept separate from pinball.js so the table layout can be tuned in isolation.

const PINBALL_TABLE_WIDTH = 360;
const PINBALL_TABLE_HEIGHT = 640;
const PINBALL_DRAIN_Y = 630;

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

// Projects (px, py) onto the segment (x1,y1)-(x2,y2), clamped to the segment.
// Writes the result into `out` and returns it, to avoid allocating on every call.
function closestPointOnSegment(px, py, x1, y1, x2, y2, out) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  out.x = x1 + t * dx;
  out.y = y1 + t * dy;
  return out;
}

function segmentsFromPolyline(points) {
  const segments = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({ x1: points[i][0], y1: points[i][1], x2: points[i + 1][0], y2: points[i + 1][1] });
  }
  return segments;
}

// Domed roof of the table, approximated as short segments between these points.
const PINBALL_DOME_POINTS = [
  [14, 170], [45, 90], [110, 48], [180, 32], [250, 48], [315, 90], [346, 170],
];

const PINBALL_WALLS = [
  { x1: 14, y1: 170, x2: 14, y2: 560 }, // left rail
  { x1: 346, y1: 170, x2: 346, y2: 560 }, // right outer rail (lane outer wall)
  { x1: 306, y1: 220, x2: 306, y2: 560 }, // lane inner wall (leaves a gap at the top for the ball to enter the field)
  ...segmentsFromPolyline(PINBALL_DOME_POINTS),
];

const PINBALL_BUMPERS = [
  { x: 110, y: 230, radius: 18, kick: 520, score: 100 },
  { x: 180, y: 190, radius: 18, kick: 520, score: 100 },
  { x: 250, y: 230, radius: 18, kick: 520, score: 100 },
];

const PINBALL_TARGETS = [
  { id: "c", x: 90, y: 420, radius: 10, score: 50 },
  { id: "o", x: 180, y: 400, radius: 10, score: 50 },
  { id: "f", x: 270, y: 420, radius: 10, score: 50 },
];

const PINBALL_FLIPPERS = {
  left: { pivotX: 120, pivotY: 560, length: 70, thickness: 14, restAngle: degToRad(200), activeAngle: degToRad(140) },
  right: { pivotX: 240, pivotY: 560, length: 70, thickness: 14, restAngle: degToRad(-20), activeAngle: degToRad(40) },
};

const PINBALL_LAUNCH = { x: 326, y: 540, minSpeed: 260, maxSpeed: 720, chargeMs: 900 };

const PINBALL_PHYSICS = {
  gravity: 620,
  restitutionWall: 0.72,
  restitutionBumper: 1.0,
  restitutionFlipper: 0.35,
  restitutionBall: 0.85,
  restitutionTarget: 0.6,
  linearDampingPerStep: 0.006,
  ballRadius: 9,
  maxBalls: 3,
  flipperActivateSpeed: Math.PI * 10,
  flipperReturnSpeed: Math.PI * 7,
};
