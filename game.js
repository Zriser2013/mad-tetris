const COLS = 10;
const ROWS = 20;
const BLOCK = 30;
const GOAL_LINES = 8;
const DROP_INTERVAL = 560;

const SHAPES = {
  I: [[1, 1, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]],
  O: [[1, 1], [1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  T: [[0, 1, 0], [1, 1, 1]],
  Z: [[1, 1, 0], [0, 1, 1]],
};

const COLORS = {
  I: '#55ddd9',
  J: '#4f86d9',
  L: '#f28a3d',
  O: '#f3c85a',
  S: '#6ac788',
  T: '#aa75d6',
  Z: '#e36165',
};

const canvas = document.querySelector('#gameCanvas');
const context = canvas.getContext('2d');
const nextCanvas = document.querySelector('#nextCanvas');
const nextContext = nextCanvas.getContext('2d');

const ui = {
  lines: document.querySelector('#linesValue'),
  score: document.querySelector('#scoreValue'),
  combo: document.querySelector('#comboValue'),
  progress: document.querySelector('#progressFill'),
  status: document.querySelector('#statusText'),
  overlay: document.querySelector('#gameOverlay'),
  overlaySymbol: document.querySelector('#overlaySymbol'),
  overlayKicker: document.querySelector('#overlayKicker'),
  overlayTitle: document.querySelector('#overlayTitle'),
  overlayCopy: document.querySelector('#overlayCopy'),
  start: document.querySelector('#startButton'),
  restart: document.querySelector('#restartButton'),
  sound: document.querySelector('#soundButton'),
};

let board = createBoard();
let currentPiece = null;
let nextType = null;
let bag = [];
let score = 0;
let lines = 0;
let combo = 0;
let playing = false;
let paused = false;
let finished = false;
let muted = false;
let dropCounter = 0;
let lastTime = 0;
let animationFrame = null;
let audioContext = null;

function createBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function shuffledBag() {
  const types = Object.keys(SHAPES);
  for (let index = types.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [types[index], types[randomIndex]] = [types[randomIndex], types[index]];
  }
  return types;
}

function takeType() {
  if (!bag.length) bag = shuffledBag();
  return bag.pop();
}

function createPiece(type) {
  const matrix = SHAPES[type].map((row) => [...row]);
  return {
    type,
    matrix,
    x: Math.floor((COLS - matrix[0].length) / 2),
    y: -1,
  };
}

function spawnPiece() {
  const type = nextType || takeType();
  currentPiece = createPiece(type);
  nextType = takeType();
  drawNextPiece();

  if (collides(currentPiece)) {
    endGame(false);
  }
}

function collides(piece, offsetX = 0, offsetY = 0, matrix = piece.matrix) {
  return matrix.some((row, y) => row.some((filled, x) => {
    if (!filled) return false;
    const targetX = piece.x + x + offsetX;
    const targetY = piece.y + y + offsetY;
    return targetX < 0 || targetX >= COLS || targetY >= ROWS || (targetY >= 0 && board[targetY][targetX]);
  }));
}

function mergePiece() {
  currentPiece.matrix.forEach((row, y) => {
    row.forEach((filled, x) => {
      if (filled && currentPiece.y + y >= 0) {
        board[currentPiece.y + y][currentPiece.x + x] = currentPiece.type;
      }
    });
  });

  const cleared = clearCompletedLines();
  if (cleared > 0) {
    combo += 1;
    score += [0, 100, 300, 500, 800][cleared] + Math.max(0, combo - 1) * 50;
    playTone(cleared === 4 ? 660 : 480, 0.09);
  } else {
    combo = 0;
  }

  updateInterface();
  if (lines >= GOAL_LINES) {
    endGame(true);
    return;
  }
  spawnPiece();
}

function clearCompletedLines() {
  let cleared = 0;
  for (let y = ROWS - 1; y >= 0; y -= 1) {
    if (board[y].every(Boolean)) {
      board.splice(y, 1);
      board.unshift(Array(COLS).fill(null));
      cleared += 1;
      y += 1;
    }
  }
  lines += cleared;
  return cleared;
}

function movePiece(direction) {
  if (!canControl()) return;
  if (!collides(currentPiece, direction, 0)) {
    currentPiece.x += direction;
    playTone(160, 0.025, 0.018);
    draw();
  }
}

function softDrop() {
  if (!canControl()) return;
  if (!collides(currentPiece, 0, 1)) {
    currentPiece.y += 1;
    score += 1;
  } else {
    mergePiece();
  }
  dropCounter = 0;
  updateInterface();
  draw();
}

function automaticDrop() {
  if (!collides(currentPiece, 0, 1)) {
    currentPiece.y += 1;
  } else {
    mergePiece();
  }
  dropCounter = 0;
}

function hardDrop() {
  if (!canControl()) return;
  let distance = 0;
  while (!collides(currentPiece, 0, distance + 1)) distance += 1;
  currentPiece.y += distance;
  score += distance * 2;
  playTone(220, 0.055, 0.04);
  mergePiece();
  updateInterface();
  draw();
}

function rotatePiece() {
  if (!canControl()) return;
  const rotated = currentPiece.matrix[0].map((_, index) => currentPiece.matrix.map((row) => row[index]).reverse());
  const kicks = [0, -1, 1, -2, 2];
  const kick = kicks.find((offset) => !collides(currentPiece, offset, 0, rotated));
  if (kick !== undefined) {
    currentPiece.matrix = rotated;
    currentPiece.x += kick;
    playTone(310, 0.035, 0.025);
    draw();
  }
}

function ghostY() {
  let distance = 0;
  while (!collides(currentPiece, 0, distance + 1)) distance += 1;
  return currentPiece.y + distance;
}

function drawBlock(targetContext, x, y, color, size = BLOCK, alpha = 1, ghost = false) {
  const padding = ghost ? 5 : 2;
  targetContext.save();
  targetContext.globalAlpha = alpha;
  if (ghost) {
    targetContext.strokeStyle = color;
    targetContext.lineWidth = 1.5;
    targetContext.strokeRect(x * size + padding, y * size + padding, size - padding * 2, size - padding * 2);
  } else {
    const gradient = targetContext.createLinearGradient(x * size, y * size, (x + 1) * size, (y + 1) * size);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, shadeColor(color, -22));
    targetContext.fillStyle = gradient;
    targetContext.fillRect(x * size + padding, y * size + padding, size - padding * 2, size - padding * 2);
    targetContext.fillStyle = 'rgba(255,255,255,0.22)';
    targetContext.fillRect(x * size + padding + 2, y * size + padding + 2, size - padding * 2 - 4, 2);
  }
  targetContext.restore();
}

function shadeColor(hex, amount) {
  const value = parseInt(hex.slice(1), 16);
  const red = Math.max(0, Math.min(255, (value >> 16) + amount));
  const green = Math.max(0, Math.min(255, ((value >> 8) & 0xff) + amount));
  const blue = Math.max(0, Math.min(255, (value & 0xff) + amount));
  return `rgb(${red}, ${green}, ${blue})`;
}

function drawGrid() {
  context.fillStyle = '#07121e';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = 'rgba(126, 163, 181, 0.055)';
  context.lineWidth = 1;
  for (let x = 0; x <= COLS; x += 1) {
    context.beginPath();
    context.moveTo(x * BLOCK + 0.5, 0);
    context.lineTo(x * BLOCK + 0.5, canvas.height);
    context.stroke();
  }
  for (let y = 0; y <= ROWS; y += 1) {
    context.beginPath();
    context.moveTo(0, y * BLOCK + 0.5);
    context.lineTo(canvas.width, y * BLOCK + 0.5);
    context.stroke();
  }

  const glow = context.createLinearGradient(0, 0, 0, canvas.height);
  glow.addColorStop(0, 'rgba(86, 224, 220, 0.055)');
  glow.addColorStop(0.22, 'rgba(0, 0, 0, 0)');
  glow.addColorStop(1, 'rgba(0, 0, 0, 0.18)');
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function drawMatrix(matrix, offsetX, offsetY, type, isGhost = false) {
  matrix.forEach((row, y) => {
    row.forEach((filled, x) => {
      if (filled && offsetY + y >= 0) {
        drawBlock(context, offsetX + x, offsetY + y, COLORS[type], BLOCK, isGhost ? 0.42 : 1, isGhost);
      }
    });
  });
}

function draw() {
  drawGrid();
  board.forEach((row, y) => row.forEach((type, x) => {
    if (type) drawBlock(context, x, y, COLORS[type]);
  }));

  if (currentPiece) {
    drawMatrix(currentPiece.matrix, currentPiece.x, ghostY(), currentPiece.type, true);
    drawMatrix(currentPiece.matrix, currentPiece.x, currentPiece.y, currentPiece.type);
  }
}

function drawNextPiece() {
  nextContext.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  if (!nextType) return;
  const matrix = SHAPES[nextType];
  const size = 24;
  const width = matrix[0].length * size;
  const height = matrix.length * size;
  const startX = (nextCanvas.width - width) / 2 / size;
  const startY = (nextCanvas.height - height) / 2 / size;
  matrix.forEach((row, y) => row.forEach((filled, x) => {
    if (filled) drawBlock(nextContext, startX + x, startY + y, COLORS[nextType], size);
  }));
}

function updateInterface() {
  ui.lines.textContent = Math.min(lines, GOAL_LINES);
  ui.score.textContent = String(score).padStart(6, '0');
  ui.combo.textContent = combo;
  ui.progress.style.width = `${Math.min(100, (lines / GOAL_LINES) * 100)}%`;
}

function showOverlay({ symbol, kicker, title, copy, button }) {
  ui.overlaySymbol.textContent = symbol;
  ui.overlayKicker.textContent = kicker;
  ui.overlayTitle.textContent = title;
  ui.overlayCopy.textContent = copy;
  ui.start.textContent = button;
  ui.overlay.classList.add('is-visible');
}

function hideOverlay() {
  ui.overlay.classList.remove('is-visible');
}

function startGame() {
  if (paused && !finished) {
    togglePause();
    return;
  }

  board = createBoard();
  bag = [];
  score = 0;
  lines = 0;
  combo = 0;
  nextType = takeType();
  playing = true;
  paused = false;
  finished = false;
  lastTime = performance.now();
  dropCounter = 0;
  spawnPiece();
  updateInterface();
  ui.status.textContent = '信号传输中';
  hideOverlay();
  playTone(420, 0.08, 0.045);

  cancelAnimationFrame(animationFrame);
  animationFrame = requestAnimationFrame(update);
}

function endGame(won) {
  playing = false;
  finished = true;
  cancelAnimationFrame(animationFrame);
  if (won) {
    ui.status.textContent = '关卡完成';
    showOverlay({
      symbol: '✦',
      kicker: 'MISSION COMPLETE',
      title: '信号塔已点亮',
      copy: `最终得分 ${String(score).padStart(6, '0')}`,
      button: '再玩一次 →',
    });
    playSequence([523, 659, 784]);
  } else {
    ui.status.textContent = '信号中断';
    showOverlay({
      symbol: '×',
      kicker: 'SIGNAL LOST',
      title: '方块堆到顶了',
      copy: '调整节奏，再试一次',
      button: '重新连接 →',
    });
    playTone(130, 0.22, 0.06);
  }
  draw();
}

function togglePause() {
  if (!playing || finished) return;
  paused = !paused;
  if (paused) {
    cancelAnimationFrame(animationFrame);
    ui.status.textContent = '传输暂停';
    showOverlay({
      symbol: 'Ⅱ',
      kicker: 'PAUSED',
      title: '信号已暂存',
      copy: '按 P 或按钮继续',
      button: '继续游戏 →',
    });
  } else {
    hideOverlay();
    ui.status.textContent = '信号传输中';
    lastTime = performance.now();
    animationFrame = requestAnimationFrame(update);
  }
}

function canControl() {
  return playing && !paused && !finished && currentPiece;
}

function update(time = 0) {
  if (!playing || paused) return;
  const delta = time - lastTime;
  lastTime = time;
  dropCounter += delta;
  if (dropCounter >= DROP_INTERVAL) automaticDrop();
  draw();
  if (playing && !paused) animationFrame = requestAnimationFrame(update);
}

function ensureAudio() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === 'suspended') audioContext.resume();
}

function playTone(frequency, duration, volume = 0.035) {
  if (muted) return;
  ensureAudio();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(volume, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

function playSequence(frequencies) {
  frequencies.forEach((frequency, index) => {
    window.setTimeout(() => playTone(frequency, 0.14, 0.045), index * 110);
  });
}

function handleAction(action) {
  const actions = {
    left: () => movePiece(-1),
    right: () => movePiece(1),
    rotate: rotatePiece,
    down: softDrop,
    drop: hardDrop,
  };
  actions[action]?.();
}

document.addEventListener('keydown', (event) => {
  const keyActions = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'rotate',
    ArrowDown: 'down',
    ' ': 'drop',
  };
  if (keyActions[event.key]) {
    if (playing) event.preventDefault();
    handleAction(keyActions[event.key]);
  }
  if (event.key.toLowerCase() === 'p') togglePause();
  if (event.key.toLowerCase() === 'r') startGame();
});

document.querySelectorAll('[data-action]').forEach((button) => {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handleAction(button.dataset.action);
  });
});

ui.start.addEventListener('click', startGame);
ui.restart.addEventListener('click', startGame);
ui.sound.addEventListener('click', () => {
  muted = !muted;
  ui.sound.classList.toggle('is-muted', muted);
  ui.sound.setAttribute('aria-label', muted ? '开启音效' : '关闭音效');
  if (!muted) playTone(440, 0.06, 0.03);
});

draw();
updateInterface();
