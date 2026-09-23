# Recordly 1.5.0-beta.1

Experimental build from the auto-captions work.

## Highlights

- Launch now asks whether to open a recent project or start a new recording.
- Auto captions keep more speech: audio is normalized and TranscribeKit runs in short chunks so quiet talk is not dropped.
- Editing a `.recordly` file on disk reloads the open editor.
- The webcam camera starts only while recording.
- Captions panel can split clips on subtitle timestamps and keep only the spoken parts.

## Notes

This is a prerelease. Please test captions, clip keep, and the launch project chooser before promoting it to stable.
