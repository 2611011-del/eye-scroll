/*
 * Eye Scroll - 브라우저 체험용 미니게임
 * MediaPipe Face Mesh(iris 옵션)로 눈동자 위치를 추정해
 * 화면 하단 바구니를 좌우로 움직여 떨어지는 별을 잡는 게임입니다.
 *
 * 정확한 실제 프로그램(OpenCV+MediaPipe+PyAutoGUI, 데스크톱)의 데모 버전이며,
 * 여기서는 마우스를 직접 움직이는 대신 게임 속 바구니를 움직입니다.
 */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('inputVideo');

const startOverlay = document.getElementById('startOverlay');
const startCameraBtn = document.getElementById('startCameraBtn');
const overlayMessage = document.getElementById('overlayMessage');
const scoreLabel = document.getElementById('scoreLabel');
const trackStatus = document.getElementById('trackStatus');
const flipXBtn = document.getElementById('flipXBtn');
const keyboardBtn = document.getElementById('keyboardBtn');

// ---- 게임 상태 ----
const W = canvas.width;
const H = canvas.height;

const basket = { x: W / 2, y: H - 34, width: 90, height: 18, targetX: W / 2 };
let stars = [];
let score = 0;
let running = false;
let lastSpawn = 0;
let spawnInterval = 1100;

// ---- 시선(홍채) 제어 상태 ----
let gazeOffset = 0;      // -1(왼쪽) ~ 1(오른쪽), 보정된 값
let smoothedRatio = 0.5; // 원본 홍채 좌우 비율의 스무딩 값
let baseline = 0.5;      // 정면을 바라볼 때의 기준값
let calibrating = false;
let calibSamples = [];
let flipX = false;
let keyboardEnabled = true;
let keyLeft = false;
let keyRight = false;

// ---- 눈동자(홍채) 비율 계산 ----
// RIGHT_IRIS: 눈동자 둘레 4점, 오른쪽 눈 좌우 경계: 33(바깥쪽) / 133(안쪽)
const IRIS_IDX = [469, 470, 471, 472];
const EYE_LEFT_IDX = 33;
const EYE_RIGHT_IDX = 133;

function computeGazeRatio(landmarks) {
    let ix = 0;
    for (const i of IRIS_IDX) ix += landmarks[i].x;
    ix /= IRIS_IDX.length;

    const xa = landmarks[EYE_LEFT_IDX].x;
    const xb = landmarks[EYE_RIGHT_IDX].x;
    const lo = Math.min(xa, xb);
    const hi = Math.max(xa, xb);
    if (hi - lo < 1e-5) return null;

    let ratio = (ix - lo) / (hi - lo);
    return Math.min(1, Math.max(0, ratio));
}

function onFaceResults(results) {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        trackStatus.textContent = '얼굴을 찾는 중...';
        return;
    }

    const landmarks = results.multiFaceLandmarks[0];
    const ratio = computeGazeRatio(landmarks);
    if (ratio === null) return;

    smoothedRatio = smoothedRatio * 0.7 + ratio * 0.3;

    if (calibrating) {
        calibSamples.push(smoothedRatio);
        trackStatus.textContent = '가운데를 봐주세요 (보정 중)';
        return;
    }

    let offset = (smoothedRatio - baseline) * 3.2; // 민감도
    if (flipX) offset *= -1;
    gazeOffset = Math.min(1, Math.max(-1, offset));

    trackStatus.textContent = '추적 중';
}

// ---- 카메라 / MediaPipe 초기화 ----
let cameraStarted = false;

function startCamera() {
    if (cameraStarted) return;
    cameraStarted = true;

    startCameraBtn.disabled = true;
    startCameraBtn.textContent = '카메라 준비 중...';

    if (typeof FaceMesh === 'undefined' || typeof Camera === 'undefined') {
        showCameraError('체험에 필요한 구성 요소를 불러오지 못했어요. 네트워크 상태를 확인한 뒤 새로고침 해주세요.');
        return;
    }

    const faceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });
    faceMesh.setOptions({
        maxNumFaces: 1,
        refineLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });
    faceMesh.onResults(onFaceResults);

    const camera = new Camera(video, {
        onFrame: async () => {
            await faceMesh.send({ image: video });
        },
        width: 640,
        height: 480
    });

    camera.start()
        .then(() => {
            startOverlay.classList.add('hidden');
            runCalibration();
            startGame();
        })
        .catch(() => {
            showCameraError('카메라를 사용할 수 없어요. 브라우저의 카메라 권한을 허용했는지 확인해주세요. 카메라 없이도 아래 키보드(←/→)로 체험할 수 있어요.');
        });
}

function showCameraError(message) {
    overlayMessage.textContent = message;
    startCameraBtn.textContent = '다시 시도';
    startCameraBtn.disabled = false;
    cameraStarted = false;
    // 카메라 없이도 키보드로 체험 가능하도록 게임은 바로 시작
    startGame();
}

function runCalibration() {
    calibrating = true;
    calibSamples = [];
    setTimeout(() => {
        if (calibSamples.length > 0) {
            baseline = calibSamples.reduce((a, b) => a + b, 0) / calibSamples.length;
        }
        calibrating = false;
        trackStatus.textContent = '추적 중';
    }, 2000);
}

startCameraBtn.addEventListener('click', startCamera);

flipXBtn.addEventListener('click', () => {
    flipX = !flipX;
    flipXBtn.classList.toggle('active', flipX);
});

keyboardBtn.addEventListener('click', () => {
    keyboardEnabled = !keyboardEnabled;
    keyboardBtn.classList.toggle('active', keyboardEnabled);
});
keyboardBtn.classList.add('active');

document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') keyLeft = true;
    if (e.key === 'ArrowRight') keyRight = true;
});
document.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') keyLeft = false;
    if (e.key === 'ArrowRight') keyRight = false;
});

// ---- 게임 로직 ----
function startGame() {
    if (running) return;
    running = true;
    stars = [];
    score = 0;
    updateScoreLabel();
    lastSpawn = performance.now();
    requestAnimationFrame(loop);
}

function updateScoreLabel() {
    scoreLabel.textContent = `점수: ${score}`;
}

function spawnStar() {
    stars.push({
        x: 24 + Math.random() * (W - 48),
        y: -16,
        r: 10,
        speed: 1.6 + Math.random() * 1.4
    });
}

function loop(now) {
    if (!running) return;

    // 바구니 목표 위치: 시선 오프셋 + 키보드 보정
    let keyboardDelta = 0;
    if (keyboardEnabled) {
        if (keyLeft) keyboardDelta -= 6;
        if (keyRight) keyboardDelta += 6;
    }

    basket.targetX = W / 2 + gazeOffset * (W / 2 - basket.width / 2);
    basket.x += (basket.targetX - basket.x) * 0.18 + keyboardDelta;
    basket.x = Math.min(W - basket.width / 2, Math.max(basket.width / 2, basket.x));

    if (now - lastSpawn > spawnInterval) {
        spawnStar();
        lastSpawn = now;
        spawnInterval = Math.max(600, spawnInterval - 6);
    }

    for (let i = stars.length - 1; i >= 0; i--) {
        const s = stars[i];
        s.y += s.speed;

        const hitBasket =
            s.y + s.r >= basket.y &&
            s.y - s.r <= basket.y + basket.height &&
            s.x >= basket.x - basket.width / 2 &&
            s.x <= basket.x + basket.width / 2;

        if (hitBasket) {
            stars.splice(i, 1);
            score += 1;
            updateScoreLabel();
            continue;
        }

        if (s.y > H + 20) {
            stars.splice(i, 1);
        }
    }

    draw();
    requestAnimationFrame(loop);
}

function draw() {
    ctx.fillStyle = '#0f1729';
    ctx.fillRect(0, 0, W, H);

    // 별
    ctx.fillStyle = '#facc15';
    stars.forEach((s) => {
        drawStar(s.x, s.y, 5, s.r, s.r / 2);
    });

    // 바구니
    ctx.fillStyle = '#4f46e5';
    ctx.beginPath();
    ctx.roundRect(basket.x - basket.width / 2, basket.y, basket.width, basket.height, 8);
    ctx.fill();

    // 기준선(가이드)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.beginPath();
    ctx.moveTo(W / 2, 0);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
}

function drawStar(cx, cy, spikes, outerRadius, innerRadius) {
    let rot = (Math.PI / 2) * 3;
    let x = cx;
    let y = cy;
    const step = Math.PI / spikes;

    ctx.beginPath();
    ctx.moveTo(cx, cy - outerRadius);
    for (let i = 0; i < spikes; i++) {
        x = cx + Math.cos(rot) * outerRadius;
        y = cy + Math.sin(rot) * outerRadius;
        ctx.lineTo(x, y);
        rot += step;

        x = cx + Math.cos(rot) * innerRadius;
        y = cy + Math.sin(rot) * innerRadius;
        ctx.lineTo(x, y);
        rot += step;
    }
    ctx.lineTo(cx, cy - outerRadius);
    ctx.closePath();
    ctx.fill();
}

// 카메라를 시작하지 않아도 미리보기가 보이도록 초기 화면을 그려둠
draw();
