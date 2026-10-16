// 다운로드 버튼: 별도의 zip 파일을 서버/폴더에서 찾지 않고,
// 클릭하는 순간 브라우저 안에서 zip을 직접 만들어 내려줍니다.
// -> "파일이 없다"는 오류가 나지 않도록 실제 파일 내용을 이 스크립트 안에 담아둡니다.

const downloadBtn = document.getElementById('downloadBtn');
const downloadHint = document.getElementById('downloadHint');

const MAIN_PY = `import math
import platform
import threading
import time
import warnings
import cv2
import mediapipe as mp
import pyautogui
import pyperclip
import speech_recognition as sr

warnings.filterwarnings('ignore')

# PyAutoGUI 설정
pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0

screen_w, screen_h = pyautogui.size()

# MediaPipe Face Mesh 초기화
mp_face_mesh = mp.solutions.face_mesh
face_mesh = mp_face_mesh.FaceMesh(
    max_num_faces=1,
    refine_landmarks=True,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5,
)

cap = cv2.VideoCapture(0)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)

prev_x, prev_y = screen_w // 2, screen_h // 2
smooth_factor = 0.25  # 커서 이동 부드러움 정도 (0.1 ~ 0.5)

# --- 클릭/드래그 상태 변수 ---
is_pressed = False
blink_frames = 0
BLINK_THRESHOLD = 3

# --- 캘리브레이션 변수 ---
is_calibrated = False
calibration_start_time = time.time()
calib_nose_x_list = []
calib_nose_y_list = []

range_x = 0.05
range_y = 0.04

min_x, max_x = 0.0, 1.0
min_y, max_y = 0.0, 1.0

# --- 음성 인식 설정 ---
recognizer = sr.Recognizer()
last_spoken_text = ''
is_listening_active = True

# OS 확인 (macOS는 command+v, Windows/Linux는 ctrl+v)
PASTE_KEY = 'command' if platform.system() == 'Darwin' else 'ctrl'


def listen_voice_background():
  """웹 입력창에 한글이 깨지지 않고 들어가도록 클립보드 붙여넣기 방식 적용"""
  global last_spoken_text, is_listening_active

  with sr.Microphone() as source:
    recognizer.adjust_for_ambient_noise(source, duration=1)
    print('마이크 준비 완료! 웹 브라우저 입력창을 클릭하고 말씀하세요.')

    while is_listening_active:
      try:
        audio = recognizer.listen(source, timeout=3, phrase_time_limit=5)
        text = recognizer.recognize_google(audio, language='ko-KR')

        if text:
          print(f'[인식된 텍스트]: {text}')
          last_spoken_text = text

          # 1. 텍스트를 클립보드에 복사 (공백 포함)
          pyperclip.copy(text + ' ')

          # 2. 현재 포커스된 웹 입력창에 붙여넣기 실행
          pyautogui.hotkey(PASTE_KEY, 'v')

      except sr.WaitTimeoutError:
        pass
      except sr.UnknownValueError:
        pass
      except sr.RequestError as e:
        print(f'API 오류: {e}')
      except Exception:
        pass


# 음성 인식 전용 데몬 스레드 시작
voice_thread = threading.Thread(target=listen_voice_background, daemon=True)
voice_thread.start()

print(
    '프로그램 시작: 3초 동안 화면 중앙을 정면으로 응시해주세요 (자동'
    ' 캘리브레이션)'
)


def get_distance(p1, p2):
  return math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2)


while cap.isOpened():
  success, frame = cap.read()
  if not success:
    break

  frame = cv2.flip(frame, 1)
  h, w, _ = frame.shape

  rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
  results = face_mesh.process(rgb_frame)

  if results.multi_face_landmarks:
    for face_landmarks in results.multi_face_landmarks:
      landmarks = face_landmarks.landmark
      nose = landmarks[1]

      # --- [1] 자동 캘리브레이션 ---
      if not is_calibrated:
        elapsed = time.time() - calibration_start_time
        calib_nose_x_list.append(nose.x)
        calib_nose_y_list.append(nose.y)

        cv2.putText(
            frame,
            f'Calibrating... {int(3 - elapsed) + 1}s (Look at Center)',
            (30, 50),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.8,
            (0, 0, 255),
            2,
        )

        if elapsed > 3.0:
          center_x = sum(calib_nose_x_list) / len(calib_nose_x_list)
          center_y = sum(calib_nose_y_list) / len(calib_nose_y_list)

          min_x, max_x = center_x - range_x, center_x + range_x
          min_y, max_y = center_y - range_y, center_y + range_y

          is_calibrated = True
          print('캘리브레이션 완료!')
        continue

      # --- [2] 마우스 커서 이동 ---
      target_x = (nose.x - min_x) / (max_x - min_x + 1e-6)
      target_y = (nose.y - min_y) / (max_y - min_y + 1e-6)

      target_x = max(0.0, min(1.0, target_x))
      target_y = max(0.0, min(1.0, target_y))

      mouse_x = int(target_x * screen_w)
      mouse_y = int(target_y * screen_h)

      curr_x = int(prev_x + (mouse_x - prev_x) * smooth_factor)
      curr_y = int(prev_y + (mouse_y - prev_y) * smooth_factor)

      if is_pressed or abs(curr_x - prev_x) > 2 or abs(curr_y - prev_y) > 2:
        pyautogui.moveTo(curr_x, curr_y)
        prev_x, prev_y = curr_x, curr_y

      # --- [3] 눈 감기 감지 ---
      vertical_dist = get_distance(landmarks[159], landmarks[145])
      horizontal_dist = get_distance(landmarks[33], landmarks[133])
      ear = vertical_dist / (horizontal_dist + 1e-6)

      if ear < 0.16:
        blink_frames += 1
        if blink_frames >= BLINK_THRESHOLD and not is_pressed:
          pyautogui.mouseDown()
          is_pressed = True
      else:
        if is_pressed:
          pyautogui.mouseUp()
          is_pressed = False
        blink_frames = 0

      # 화면 상태 및 음성 텍스트 표시
      if is_pressed:
        cv2.putText(
            frame,
            'DRAGGING...',
            (50, 100),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            (0, 0, 255),
            3,
        )

      if last_spoken_text:
        cv2.putText(
            frame,
            f'Voice: {last_spoken_text}',
            (30, h - 30),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            (255, 255, 0),
            2,
        )

      nose_cx, nose_cy = int(nose.x * w), int(nose.y * h)
      cv2.circle(frame, (nose_cx, nose_cy), 5, (0, 255, 0), -1)

  else:
    if is_pressed:
      pyautogui.mouseUp()
      is_pressed = False

  cv2.imshow('Head Pose Control Mouse', frame)

  key = cv2.waitKey(1) & 0xFF
  if key == ord('q') or key == 27:
    break

is_listening_active = False
if is_pressed:
  pyautogui.mouseUp()

cap.release()
cv2.destroyAllWindows()
`;

const REQUIREMENTS_TXT = `opencv-python
mediapipe
pyautogui
pyperclip
SpeechRecognition
PyAudio
`;

const README_TXT = `Eye Scroll 실행 방법

1) 이 폴더에서 터미널을 열고 아래 명령어로 필요한 패키지를 설치하세요.
   pip install -r requirements.txt

   * 마이크 음성 인식을 쓰려면 PyAudio 설치가 필요해요.
     설치가 안 되면 아래처럼 시도해보세요.
     - Windows: pip install pipwin  ->  pipwin install pyaudio
     - macOS:   brew install portaudio  ->  pip install pyaudio

2) 아래 명령어로 프로그램을 실행하세요.
   python main.py

3) 실행 후 3초간 화면 중앙을 정면으로 바라보면 자동으로 캘리브레이션됩니다.
   - 고개(코 위치) 움직임으로 마우스 커서가 이동해요.
   - 눈을 잠깐 감으면 클릭/드래그가 시작되고, 뜨면 놓여요.
   - 마이크에 말하면 인식된 문장이 현재 포커스된 입력창에 자동으로 붙여넣기 돼요.
   - q 또는 Esc 키를 누르면 종료됩니다.
`;

downloadBtn.addEventListener('click', async () => {
    downloadBtn.disabled = true;
    downloadBtn.textContent = '압축 파일 만드는 중...';

    try {
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip 로드 실패');
        }

        const zip = new JSZip();
        zip.file('main.py', MAIN_PY);
        zip.file('requirements.txt', REQUIREMENTS_TXT);
        zip.file('README.txt', README_TXT);

        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = 'eyescroll_installer.zip';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        setTimeout(() => URL.revokeObjectURL(url), 5000);

        downloadHint.textContent = '다운로드 완료! 압축을 풀고 README.txt를 확인해주세요.';
    } catch (err) {
        downloadHint.textContent = '다운로드 중 문제가 생겼어요. 네트워크 상태를 확인한 뒤 새로고침 후 다시 시도해주세요.';
    } finally {
        downloadBtn.disabled = false;
        downloadBtn.textContent = '다운로드';
    }
});
