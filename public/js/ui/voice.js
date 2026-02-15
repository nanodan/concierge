// --- Voice Input (SpeechRecognition) ---
import * as state from '../state.js';

// DOM elements (set by init)
let micBtn = null;
let messageInput = null;
let autoResizeInputFn = null;

export function initVoice(elements, autoResizeFn) {
  micBtn = elements.micBtn;
  messageInput = elements.messageInput;
  autoResizeInputFn = autoResizeFn;
}

export function startRecording() {
  const recognition = state.getRecognition();
  if (!recognition) return;
  state.setIsRecording(true);
  micBtn.classList.add('recording');
  // Save existing textarea content
  messageInput.dataset.preRecordingText = messageInput.value;
  try {
    recognition.start();
  } catch {
    // Already started
  }
}

export function stopRecording() {
  const recognition = state.getRecognition();
  if (!recognition) return;
  state.setIsRecording(false);
  micBtn.classList.remove('recording');
  try {
    recognition.stop();
  } catch {
    // Already stopped
  }
  delete messageInput.dataset.preRecordingText;
}

// --- Setup voice recognition event listeners ---
export function setupVoiceEventListeners() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.classList.add('hidden');
    return;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (e) => {
    let finalTranscript = '';
    let interimTranscript = '';
    for (let i = 0; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }
    const prefix = messageInput.dataset.preRecordingText || '';
    messageInput.value = prefix + finalTranscript + interimTranscript;
    if (autoResizeInputFn) autoResizeInputFn();
  };

  recognition.onerror = () => {
    stopRecording();
  };

  recognition.onend = () => {
    if (state.getIsRecording()) {
      stopRecording();
    }
  };

  state.setRecognition(recognition);

  micBtn.addEventListener('click', () => {
    if (state.getIsRecording()) {
      stopRecording();
    } else {
      startRecording();
    }
  });
}
