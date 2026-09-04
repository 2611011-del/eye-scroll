/*
 * Eye Scroll - 브라우저 체험용 미니게임
 * MediaPipe Face Mesh로 "코 끝(nose tip)" 위치를 추적해,
 * 실제 프로그램처럼 고개를 좌우로 돌리는 움직임으로
 * 화면 하단 바구니를 옮겨 떨어지는 별을 잡는 게임입니다.
 *
 * 실제 데스크톱 프로그램(OpenCV+MediaPipe+PyAutoGUI)과 같은 방식으로,
 * 처음 2초간 정면을 보면 그 위치를 기준점으로 자동 보정(캘리브레이션)한 뒤
 * 그 기준에서 고개가 얼마나 움직였는지로 좌우 위치를 계산합니다.
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

// ---- 고개(머리) 위치 제어 상태 ----
let headOffset = 0;      // -1(왼쪽) ~ 1(오른쪽), 보정된 값
let smoothedNoseX = 0.5; // 코 끝 x좌표의 스무딩 값
let baseline = 0.5;      // 정면을 바라볼 때의 기준값(캘리브레이션 결과)
let calibrating = false;
let calibSamples = [];
let flipX = false;
let keyboardEnabled = true;
let keyLeft = false;
let keyRight = false;

// ---- 코 끝(nose tip) 위치 계산 ----
// 실제 프로그램(nosecast.py)과 동일하게 landmark[1](코 끝)의 위치를 기준으로,
// 정면 기준점에서 얼마나 좌우로 움직였는지를 계산합니다.
const NOSE_IDX = 1;
const HEAD_RANGE_X = 0.045; // 이 정도 고개 움직임이면 화면 끝까지 이동 (실제 프로그램의 range_x와 비슷한 값)

function onFaceResults(results) {
    if (!results.multiFaceLandmarks || results.multiFaceLandmarks.length === 0) {
        trackStatus.textContent = '얼굴을 찾는 중...';
        return;
    }

    const landmarks = results.multiFaceLandmarks[0];
    const noseX = landmarks[NOSE_IDX].x;

    smoothedNoseX = smoothedNoseX * 0.7 + noseX * 0.3;

    if (calibrating) {
        calibSamples.push(smoothedNoseX);
        trackStatus.textContent = '정면을 봐주세요 (보정 중)';
        return;
    }

    let offset = (smoothedNoseX - baseline) / HEAD_RANGE_X;
    if (flipX) offset *= -1;
    headOffset = Math.min(1, Math.max(-1, offset));

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

    basket.targetX = W / 2 + headOffset * (W / 2 - basket.width / 2);
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
