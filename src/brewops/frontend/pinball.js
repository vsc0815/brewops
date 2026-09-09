// Coffee Flipper — a hand-rolled, dependency-free 2D pinball engine.
// Depends on globals from pinball-table.js (loaded first) and, where present,
// on i18n.js's t()/currentLang (guarded so this file works even if i18n.js
// were ever removed).

const PINBALL_STEP_MS = 1000 / 120; // fixed physics timestep, independent of display refresh rate
const PINBALL_MAX_SUBSTEPS = 5; // caps worst-case per-frame work after a lagging/backgrounded tab
const PINBALL_SERVE_DELAY_S = 0.9;
const PINBALL_THEMES = ["beach", "mountains", "teahouse"];

function pinballT(key, vars) {
  return typeof t === "function" ? t(key, vars) : key;
}

const pinballState = {
  active: false,
  rafHandle: null,
  lastTimestampMs: 0,
  accumulatorMs: 0,
  canvas: null,
  ctx: null,
  cssWidth: 0,
  cssHeight: 0,
  scale: 1,
  backgroundCanvas: null,
  themeIndex: 0,
  balls: [],
  flippers: {
    left: { angle: PINBALL_FLIPPERS.left.restAngle, angularVel: 0, held: false },
    right: { angle: PINBALL_FLIPPERS.right.restAngle, angularVel: 0, held: false },
  },
  plunger: { charging: false, chargeElapsedMs: 0, waitingBallIndex: -1 },
  bumperFlashMs: new Float32Array(PINBALL_BUMPERS.length),
  litTargets: new Set(),
  score: 0,
  lives: 3,
  gameOver: false,
  awaitingServe: false,
  serveCountdownS: 0,
  lastRenderedScore: null,
  lastRenderedLives: null,
};

// Reused scratch object so collision checks don't allocate on every call.
const _pinballScratch = { x: 0, y: 0 };

function pinballCreateBallPool() {
  const pool = [];
  for (let i = 0; i < PINBALL_PHYSICS.maxBalls; i++) {
    pool.push({ x: 0, y: 0, vx: 0, vy: 0, alive: false });
  }
  return pool;
}

function pinballResetGameState() {
  pinballState.balls = pinballState.balls.length ? pinballState.balls : pinballCreateBallPool();
  for (const ball of pinballState.balls) {
    ball.alive = false;
    ball.vx = 0;
    ball.vy = 0;
  }
  pinballState.flippers.left.angle = PINBALL_FLIPPERS.left.restAngle;
  pinballState.flippers.left.angularVel = 0;
  pinballState.flippers.left.held = false;
  pinballState.flippers.right.angle = PINBALL_FLIPPERS.right.restAngle;
  pinballState.flippers.right.angularVel = 0;
  pinballState.flippers.right.held = false;
  pinballState.plunger.charging = false;
  pinballState.plunger.chargeElapsedMs = 0;
  pinballState.bumperFlashMs.fill(0);
  pinballState.litTargets.clear();
  pinballState.score = 0;
  pinballState.lives = 3;
  pinballState.gameOver = false;
  pinballState.awaitingServe = false;
  pinballState.serveCountdownS = 0;
  pinballState.lastRenderedScore = null;
  pinballState.lastRenderedLives = null;
  pinballState.themeIndex = (pinballState.themeIndex + 1) % PINBALL_THEMES.length;
  pinballServeBall();
}

function pinballServeBall() {
  const ball = pinballState.balls.find((b) => !b.alive);
  if (!ball) return;
  ball.x = PINBALL_LAUNCH.x;
  ball.y = PINBALL_LAUNCH.y;
  ball.vx = 0;
  ball.vy = 0;
  ball.alive = true;
  pinballState.plunger.waitingBallIndex = pinballState.balls.indexOf(ball);
}

function pinballLaunchWaitingBall(speed) {
  const index = pinballState.plunger.waitingBallIndex;
  if (index < 0) return;
  const ball = pinballState.balls[index];
  if (ball && ball.alive) {
    ball.vy = -speed;
    ball.vx = -40;
  }
  pinballState.plunger.waitingBallIndex = -1;
}

// ---- view toggling ----

function pinballShowGame() {
  document.querySelectorAll(".dash-panel").forEach((el) => {
    el.hidden = true;
  });
  document.getElementById("pinball-view").hidden = false;
  pinballStartLoop();
}

function pinballShowDashboard() {
  pinballStopLoop();
  document.getElementById("pinball-view").hidden = true;
  document.querySelectorAll(".dash-panel").forEach((el) => {
    el.hidden = false;
  });
}

function pinballStartLoop() {
  if (pinballState.active) return; // guards against a double-click starting two loops
  pinballState.active = true;
  pinballState.lastTimestampMs = 0;
  pinballState.accumulatorMs = 0;
  pinballResetGameState();
  pinballResizeCanvas();
  document.addEventListener("keydown", pinballHandleKeyDown);
  document.addEventListener("keyup", pinballHandleKeyUp);
  window.addEventListener("resize", pinballHandleResize);
  pinballState.rafHandle = requestAnimationFrame(pinballFrame);
}

function pinballStopLoop() {
  pinballState.active = false; // makes any already-queued rAF callback a no-op
  if (pinballState.rafHandle !== null) cancelAnimationFrame(pinballState.rafHandle);
  pinballState.rafHandle = null;
  document.removeEventListener("keydown", pinballHandleKeyDown);
  document.removeEventListener("keyup", pinballHandleKeyUp);
  window.removeEventListener("resize", pinballHandleResize);
}

// A backgrounded tab gets its rAF calls throttled by the browser already; resetting
// the timestamp baseline on return avoids the loop trying to "catch up" a huge gap.
document.addEventListener("visibilitychange", () => {
  if (pinballState.active && !document.hidden) {
    pinballState.lastTimestampMs = 0;
  }
});

// ---- input ----

function pinballHandleKeyDown(event) {
  if (event.repeat) return; // ignore OS key-repeat, only react to the initial press
  if (event.code === "ArrowLeft" || event.code === "KeyZ") {
    pinballState.flippers.left.held = true;
    event.preventDefault();
  } else if (event.code === "ArrowRight" || event.code === "KeyM") {
    pinballState.flippers.right.held = true;
    event.preventDefault();
  } else if (event.code === "Space") {
    if (pinballState.plunger.waitingBallIndex >= 0 && !pinballState.plunger.charging) {
      pinballState.plunger.charging = true;
      pinballState.plunger.chargeElapsedMs = 0;
    }
    event.preventDefault();
  }
}

function pinballHandleKeyUp(event) {
  if (event.code === "ArrowLeft" || event.code === "KeyZ") {
    pinballState.flippers.left.held = false;
  } else if (event.code === "ArrowRight" || event.code === "KeyM") {
    pinballState.flippers.right.held = false;
  } else if (event.code === "Space") {
    if (pinballState.plunger.charging) {
      const charge = Math.max(0, Math.min(1, pinballState.plunger.chargeElapsedMs / PINBALL_LAUNCH.chargeMs));
      const speed = PINBALL_LAUNCH.minSpeed + charge * (PINBALL_LAUNCH.maxSpeed - PINBALL_LAUNCH.minSpeed);
      pinballLaunchWaitingBall(speed);
      pinballState.plunger.charging = false;
      pinballState.plunger.chargeElapsedMs = 0;
    }
  }
}

function pinballHandleResize() {
  pinballResizeCanvas();
}

// ---- canvas sizing ----

function pinballResizeCanvas() {
  const canvas = document.getElementById("pinball-canvas");
  const stage = canvas.parentElement;
  const cssWidth = stage.clientWidth;
  const cssHeight = cssWidth * (PINBALL_TABLE_HEIGHT / PINBALL_TABLE_WIDTH);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);

  const ctx = canvas.getContext("2d");
  const scale = (cssWidth * dpr) / PINBALL_TABLE_WIDTH;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  pinballState.canvas = canvas;
  pinballState.ctx = ctx;
  pinballState.cssWidth = cssWidth;
  pinballState.cssHeight = cssHeight;
  pinballState.scale = scale;
  pinballState.backgroundCanvas = pinballBuildBackground(scale);
}

// ---- fixed-timestep loop ----

function pinballFrame(timestampMs) {
  if (!pinballState.active) return;
  if (pinballState.lastTimestampMs === 0) pinballState.lastTimestampMs = timestampMs;
  let frameMs = timestampMs - pinballState.lastTimestampMs;
  pinballState.lastTimestampMs = timestampMs;
  if (frameMs > 250) frameMs = 250; // clamp a huge gap (tab was backgrounded, debugger paused, ...)

  pinballState.accumulatorMs += frameMs;
  let steps = 0;
  while (pinballState.accumulatorMs >= PINBALL_STEP_MS && steps < PINBALL_MAX_SUBSTEPS) {
    pinballStep(PINBALL_STEP_MS / 1000);
    pinballState.accumulatorMs -= PINBALL_STEP_MS;
    steps++;
  }
  if (steps === PINBALL_MAX_SUBSTEPS) pinballState.accumulatorMs = 0; // drop overflow, don't spiral

  pinballRender();
  pinballState.rafHandle = requestAnimationFrame(pinballFrame);
}

function pinballStep(dt) {
  pinballUpdateFlipper(pinballState.flippers.left, PINBALL_FLIPPERS.left, dt);
  pinballUpdateFlipper(pinballState.flippers.right, PINBALL_FLIPPERS.right, dt);

  if (pinballState.plunger.charging) {
    pinballState.plunger.chargeElapsedMs = Math.min(
      PINBALL_LAUNCH.chargeMs,
      pinballState.plunger.chargeElapsedMs + dt * 1000
    );
  }

  for (let i = 0; i < pinballState.bumperFlashMs.length; i++) {
    if (pinballState.bumperFlashMs[i] > 0) pinballState.bumperFlashMs[i] = Math.max(0, pinballState.bumperFlashMs[i] - dt * 1000);
  }

  for (const ball of pinballState.balls) {
    if (!ball.alive) continue;
    pinballApplyGravityAndDamping(ball, dt);
    pinballResolveWallCollisions(ball);
    pinballResolveFlipperCollisions(ball);
    pinballResolveBumperCollisions(ball);
    pinballResolveTargetCollisions(ball);
    pinballCheckDrain(ball);
  }
  pinballResolveBallBallCollisions();
  pinballUpdateRoundState(dt);
}

function pinballUpdateFlipper(runtime, spec, dt) {
  const target = runtime.held ? spec.activeAngle : spec.restAngle;
  const speed = runtime.held ? PINBALL_PHYSICS.flipperActivateSpeed : PINBALL_PHYSICS.flipperReturnSpeed;
  const diff = target - runtime.angle;
  const maxStep = speed * dt;
  if (Math.abs(diff) <= maxStep) {
    runtime.angle = target;
    runtime.angularVel = 0;
  } else {
    const dir = diff > 0 ? 1 : -1;
    runtime.angle += dir * maxStep;
    runtime.angularVel = dir * speed;
  }
}

function pinballApplyGravityAndDamping(ball, dt) {
  ball.vy += PINBALL_PHYSICS.gravity * dt;
  const damping = 1 - PINBALL_PHYSICS.linearDampingPerStep;
  ball.vx *= damping;
  ball.vy *= damping;
}

function pinballResolveWallCollisions(ball) {
  const radius = PINBALL_PHYSICS.ballRadius;
  for (const wall of PINBALL_WALLS) {
    closestPointOnSegment(ball.x, ball.y, wall.x1, wall.y1, wall.x2, wall.y2, _pinballScratch);
    const dx = ball.x - _pinballScratch.x;
    const dy = ball.y - _pinballScratch.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= radius) continue;
    const nx = dist > 1e-6 ? dx / dist : 1;
    const ny = dist > 1e-6 ? dy / dist : 0;
    const overlap = radius - dist;
    ball.x += nx * overlap;
    ball.y += ny * overlap;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      const j = -(1 + PINBALL_PHYSICS.restitutionWall) * vn;
      ball.vx += j * nx;
      ball.vy += j * ny;
    }
  }
}

function pinballResolveFlipperCollisions(ball) {
  pinballResolveOneFlipper(ball, pinballState.flippers.left, PINBALL_FLIPPERS.left);
  pinballResolveOneFlipper(ball, pinballState.flippers.right, PINBALL_FLIPPERS.right);
}

function pinballResolveOneFlipper(ball, runtime, spec) {
  const tipX = spec.pivotX + spec.length * Math.cos(runtime.angle);
  const tipY = spec.pivotY + spec.length * Math.sin(runtime.angle);
  closestPointOnSegment(ball.x, ball.y, spec.pivotX, spec.pivotY, tipX, tipY, _pinballScratch);
  const dx = ball.x - _pinballScratch.x;
  const dy = ball.y - _pinballScratch.y;
  const dist = Math.hypot(dx, dy);
  const combined = PINBALL_PHYSICS.ballRadius + spec.thickness / 2;
  if (dist >= combined) return;
  const nx = dist > 1e-6 ? dx / dist : 0;
  const ny = dist > 1e-6 ? dy / dist : -1;
  const overlap = combined - dist;
  ball.x += nx * overlap;
  ball.y += ny * overlap;

  const rx = _pinballScratch.x - spec.pivotX;
  const ry = _pinballScratch.y - spec.pivotY;
  const flipVx = -runtime.angularVel * ry;
  const flipVy = runtime.angularVel * rx;
  const relVx = ball.vx - flipVx;
  const relVy = ball.vy - flipVy;
  const vn = relVx * nx + relVy * ny;
  if (vn < 0) {
    const j = -(1 + PINBALL_PHYSICS.restitutionFlipper) * vn;
    ball.vx += j * nx;
    ball.vy += j * ny;
  }
}

function pinballResolveBumperCollisions(ball) {
  for (let i = 0; i < PINBALL_BUMPERS.length; i++) {
    const bumper = PINBALL_BUMPERS[i];
    const dx = ball.x - bumper.x;
    const dy = ball.y - bumper.y;
    const dist = Math.hypot(dx, dy);
    const combined = PINBALL_PHYSICS.ballRadius + bumper.radius;
    if (dist >= combined) continue;
    const nx = dist > 1e-6 ? dx / dist : 1;
    const ny = dist > 1e-6 ? dy / dist : 0;
    const overlap = combined - dist;
    ball.x += nx * overlap;
    ball.y += ny * overlap;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      const j = -(1 + PINBALL_PHYSICS.restitutionBumper) * vn;
      ball.vx += j * nx;
      ball.vy += j * ny;
    }
    const speed = Math.hypot(ball.vx, ball.vy);
    if (speed < bumper.kick) {
      ball.vx = nx * bumper.kick;
      ball.vy = ny * bumper.kick;
    }
    if (pinballState.bumperFlashMs[i] <= 0) {
      pinballState.score += bumper.score;
      pinballState.bumperFlashMs[i] = 140;
    }
  }
}

function pinballResolveTargetCollisions(ball) {
  for (const target of PINBALL_TARGETS) {
    const dx = ball.x - target.x;
    const dy = ball.y - target.y;
    const dist = Math.hypot(dx, dy);
    const combined = PINBALL_PHYSICS.ballRadius + target.radius;
    if (dist >= combined) continue;
    const nx = dist > 1e-6 ? dx / dist : 1;
    const ny = dist > 1e-6 ? dy / dist : 0;
    const overlap = combined - dist;
    ball.x += nx * overlap;
    ball.y += ny * overlap;
    const vn = ball.vx * nx + ball.vy * ny;
    if (vn < 0) {
      const j = -(1 + PINBALL_PHYSICS.restitutionTarget) * vn;
      ball.vx += j * nx;
      ball.vy += j * ny;
    }
    if (!pinballState.litTargets.has(target.id)) {
      pinballState.score += target.score;
      pinballState.litTargets.add(target.id);
      if (pinballState.litTargets.size === PINBALL_TARGETS.length) {
        pinballState.score += 500;
        pinballState.litTargets.clear();
        pinballServeBall();
      }
    }
  }
}

function pinballResolveBallBallCollisions() {
  const balls = pinballState.balls;
  for (let i = 0; i < balls.length; i++) {
    if (!balls[i].alive) continue;
    for (let j = i + 1; j < balls.length; j++) {
      if (!balls[j].alive) continue;
      const a = balls[i];
      const b = balls[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const combined = PINBALL_PHYSICS.ballRadius * 2;
      if (dist >= combined || dist < 1e-6) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = (combined - dist) / 2;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;
      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const vn = rvx * nx + rvy * ny;
      if (vn < 0) {
        const j2 = -(1 + PINBALL_PHYSICS.restitutionBall) * vn * 0.5;
        a.vx -= j2 * nx;
        a.vy -= j2 * ny;
        b.vx += j2 * nx;
        b.vy += j2 * ny;
      }
    }
  }
}

function pinballCheckDrain(ball) {
  if (ball.alive && ball.y - PINBALL_PHYSICS.ballRadius > PINBALL_DRAIN_Y) {
    ball.alive = false;
  }
}

function pinballUpdateRoundState(dt) {
  if (pinballState.gameOver) return;
  const anyAlive = pinballState.balls.some((b) => b.alive);
  if (anyAlive) {
    pinballState.awaitingServe = false;
    return;
  }
  if (!pinballState.awaitingServe) {
    pinballState.awaitingServe = true;
    pinballState.serveCountdownS = PINBALL_SERVE_DELAY_S;
    pinballState.lives -= 1;
    return;
  }
  pinballState.serveCountdownS -= dt;
  if (pinballState.serveCountdownS > 0) return;
  pinballState.awaitingServe = false;
  if (pinballState.lives > 0) {
    pinballServeBall();
  } else {
    pinballState.gameOver = true;
  }
}

// ---- rendering ----

function pinballBuildBackground(scale) {
  const offscreen = document.createElement("canvas");
  offscreen.width = Math.round(PINBALL_TABLE_WIDTH * scale);
  offscreen.height = Math.round(PINBALL_TABLE_HEIGHT * scale);
  const ctx = offscreen.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  const theme = PINBALL_THEMES[pinballState.themeIndex];
  if (theme === "beach") {
    pinballDrawBeach(ctx);
  } else if (theme === "mountains") {
    pinballDrawMountains(ctx);
  } else {
    pinballDrawTeahouse(ctx);
  }
  return offscreen;
}

function pinballDrawBeach(ctx) {
  const sky = ctx.createLinearGradient(0, 0, 0, PINBALL_TABLE_HEIGHT);
  sky.addColorStop(0, "#ffd9a0");
  sky.addColorStop(0.55, "#ff9d76");
  sky.addColorStop(1, "#2b5f6b");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, PINBALL_TABLE_WIDTH, PINBALL_TABLE_HEIGHT);

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.arc(270, 110, 34, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#123a3f";
  for (const px of [40, 320]) {
    ctx.beginPath();
    ctx.moveTo(px, 300);
    ctx.quadraticCurveTo(px - 30, 220, px - 6, 150);
    ctx.quadraticCurveTo(px + 24, 220, px, 300);
    ctx.fill();
  }
}

function pinballDrawMountains(ctx) {
  const sky = ctx.createLinearGradient(0, 0, 0, PINBALL_TABLE_HEIGHT);
  sky.addColorStop(0, "#cfe0ea");
  sky.addColorStop(0.5, "#8fa8bc");
  sky.addColorStop(1, "#33475a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, PINBALL_TABLE_WIDTH, PINBALL_TABLE_HEIGHT);

  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.moveTo(0, 260);
  ctx.lineTo(90, 130);
  ctx.lineTo(180, 260);
  ctx.lineTo(260, 150);
  ctx.lineTo(360, 260);
  ctx.lineTo(360, 320);
  ctx.lineTo(0, 320);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#3d5568";
  ctx.beginPath();
  ctx.moveTo(0, 320);
  ctx.lineTo(70, 210);
  ctx.lineTo(150, 320);
  ctx.lineTo(230, 200);
  ctx.lineTo(320, 320);
  ctx.lineTo(360, 300);
  ctx.lineTo(360, 340);
  ctx.lineTo(0, 340);
  ctx.closePath();
  ctx.fill();
}

function pinballDrawTeahouse(ctx) {
  const sky = ctx.createLinearGradient(0, 0, 0, PINBALL_TABLE_HEIGHT);
  sky.addColorStop(0, "#2a1b3d");
  sky.addColorStop(0.55, "#4a2c5e");
  sky.addColorStop(1, "#1c1024");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, PINBALL_TABLE_WIDTH, PINBALL_TABLE_HEIGHT);

  ctx.fillStyle = "rgba(255,220,160,0.9)";
  ctx.beginPath();
  ctx.arc(300, 100, 22, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#150c1c";
  ctx.fillRect(60, 220, 200, 90);
  ctx.beginPath();
  ctx.moveTo(40, 220);
  ctx.lineTo(160, 170);
  ctx.lineTo(280, 220);
  ctx.closePath();
  ctx.fill();

  for (const lx of [90, 140, 190, 230]) {
    ctx.fillStyle = "rgba(255,200,120,0.85)";
    ctx.beginPath();
    ctx.ellipse(lx, 250, 6, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function pinballRender() {
  const ctx = pinballState.ctx;
  if (!ctx) return;

  ctx.drawImage(pinballState.backgroundCanvas, 0, 0, PINBALL_TABLE_WIDTH, PINBALL_TABLE_HEIGHT);

  ctx.strokeStyle = "#d9b382";
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (const wall of PINBALL_WALLS) {
    ctx.moveTo(wall.x1, wall.y1);
    ctx.lineTo(wall.x2, wall.y2);
  }
  ctx.stroke();

  for (let i = 0; i < PINBALL_BUMPERS.length; i++) {
    const bumper = PINBALL_BUMPERS[i];
    const lit = pinballState.bumperFlashMs[i] > 0;
    ctx.fillStyle = lit ? "#ffe6b3" : "#b9812f";
    ctx.beginPath();
    ctx.arc(bumper.x, bumper.y, bumper.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const target of PINBALL_TARGETS) {
    const lit = pinballState.litTargets.has(target.id);
    ctx.fillStyle = lit ? "#3f7a3a" : "#7a6552";
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#f1e9dc";
  for (const side of ["left", "right"]) {
    const spec = PINBALL_FLIPPERS[side];
    const runtime = pinballState.flippers[side];
    ctx.save();
    ctx.translate(spec.pivotX, spec.pivotY);
    ctx.rotate(runtime.angle);
    ctx.beginPath();
    ctx.moveTo(0, -spec.thickness / 2);
    ctx.lineTo(spec.length, -spec.thickness / 2);
    ctx.arc(spec.length, 0, spec.thickness / 2, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(0, spec.thickness / 2);
    ctx.arc(0, 0, spec.thickness / 2, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  for (const ball of pinballState.balls) {
    if (!ball.alive) continue;
    const r = PINBALL_PHYSICS.ballRadius;
    ctx.fillStyle = "#43301f";
    ctx.beginPath();
    ctx.ellipse(ball.x, ball.y, r, r * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2a1c12";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y - r * 0.7);
    ctx.quadraticCurveTo(ball.x, ball.y, ball.x, ball.y + r * 0.7);
    ctx.stroke();
  }

  if (pinballState.plunger.waitingBallIndex >= 0) {
    const charge = pinballState.plunger.charging
      ? Math.max(0, Math.min(1, pinballState.plunger.chargeElapsedMs / PINBALL_LAUNCH.chargeMs))
      : 0;
    ctx.fillStyle = "#8a5a1c";
    ctx.fillRect(PINBALL_LAUNCH.x - 4, PINBALL_LAUNCH.y + 10 + charge * 14, 8, 24 - charge * 14);
  }

  pinballRenderHud();
}

function pinballRenderHud() {
  if (pinballState.score !== pinballState.lastRenderedScore) {
    document.getElementById("pinball-score").textContent = String(pinballState.score);
    pinballState.lastRenderedScore = pinballState.score;
  }
  if (pinballState.lives !== pinballState.lastRenderedLives) {
    document.getElementById("pinball-lives").textContent = String(Math.max(0, pinballState.lives));
    pinballState.lastRenderedLives = pinballState.lives;
  }
  const messageEl = document.getElementById("pinball-message");
  if (pinballState.gameOver) {
    messageEl.textContent = `${pinballT("pinball_game_over")} ${pinballT("pinball_final_score", { n: pinballState.score })} ${pinballT("pinball_new_game")}`;
  } else if (messageEl.textContent) {
    messageEl.textContent = "";
  }
}

// ---- wiring (runs once at page load; independent of game start/stop) ----

document.addEventListener("DOMContentLoaded", () => {
  const startBtn = document.getElementById("start-pinball-btn");
  const backBtn = document.getElementById("pinball-switch-back-btn");
  if (startBtn) startBtn.addEventListener("click", pinballShowGame);
  if (backBtn) backBtn.addEventListener("click", pinballShowDashboard);
});
