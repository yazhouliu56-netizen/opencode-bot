import sys, os, wave, numpy as np

audio_path = sys.argv[1]

# 1. sherpa-onnx + SenseVoice（中文最佳，快且准）
try:
    import sherpa_onnx
    model_dir = os.path.join(os.path.dirname(__file__), '..', 'models', 'sensevoice',
                             'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09')
    model_path = os.path.join(model_dir, 'model.int8.onnx')
    tokens_path = os.path.join(model_dir, 'tokens.txt')
    if os.path.exists(model_path):
        recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
            model=model_path, tokens=tokens_path, num_threads=4, language='zh')
        with wave.open(audio_path, 'rb') as wf:
            sr, frames = wf.getframerate(), wf.readframes(wf.getnframes())
            samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
        stream = recognizer.create_stream()
        stream.accept_waveform(sr, samples)
        recognizer.decode_stream(stream)
        result = stream.result.text.strip()
        if result:
            print(result)
            sys.exit(0)
except Exception as e:
    print(f'SenseVoice failed: {e}', file=sys.stderr)

# 2. faster-whisper base（备用）
try:
    from faster_whisper import WhisperModel
    model = WhisperModel('base', device='cpu', compute_type='int8')
    segments, _ = model.transcribe(audio_path, language='zh')
    result = ' '.join(seg.text for seg in segments)
    print(result.strip() or '(未识别)')
    sys.exit(0)
except Exception as e:
    print(f'Whisper failed: {e}', file=sys.stderr)

print('(识别失败)')
