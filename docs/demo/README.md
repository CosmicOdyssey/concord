# Demo video

- `script.md`: the 2:57 voiceover script (12 scenes), with what is on screen, the spoken lines, recording notes and an
  honesty checklist.
- `scenes.json`: the same scenes for the recorder (start times, durations, narration, actions with selectors).
- `../../scripts/demo/record.mjs`: one-command scripted screen recording of the running app.

## Record

Needs the app running (frontend on http://localhost:5173, backend venv in `backend/.venv`), installed Chrome, and the
npm packages `puppeteer-core` and `ffmpeg-static` on `NODE_PATH` (they live in the gitignored `data/work/D`).

```bash
NODE_PATH=data/work/D/node_modules node scripts/demo/record.mjs
```

PowerShell: `$env:NODE_PATH = 'data/work/D/node_modules'; node scripts/demo/record.mjs`

It rehearses every scene off camera first (warms every route so no spinner shows), then records at 1920x1080, 30 fps,
H.264, with an eased cursor, click ripples and a brief highlight on what is being discussed. Output in `data/work/demo/`:
`concord-demo.mp4`, `concord-demo.srt` (the narration as subtitles, to read along), `chapters.txt`, `record-log.json`
(timing and any problems) and `frames/` (one frame every 3 s). A take takes about 5 minutes.

## Watch

PowerShell: `Invoke-Item data\work\demo\concord-demo.mp4` (or `start "" data\work\demo\concord-demo.mp4` in cmd).
With subtitles: `vlc data\work\demo\concord-demo.mp4 --sub-file=data\work\demo\concord-demo.srt`.

## Change pacing or content

Edit `scenes.json` (each scene's `start_s`, `duration_s`, and each action's `at_s`, `type`, `target`) and re-record. Keep
`script.md` in step with it.

## Add the voiceover

Record your voice while the video plays (read the `.srt`), save it as `voice.wav`, then either drop both into any video
editor, or:

```bash
FF=$(node -e "console.log(require('ffmpeg-static'))")   # with NODE_PATH as above
"$FF" -i data/work/demo/concord-demo.mp4 -i voice.wav -c:v copy -c:a aac -shortest data/work/demo/concord-demo-voice.mp4
```

## How product teams usually do it

1. Scripted capture (this): a headless browser plays the product on a timeline, so every take is identical and a UI
   change is one re-run away.
2. Screen Studio, Loom or similar: a person records, and the tool adds smooth zooms, cursor smoothing and backgrounds.
3. Interactive demos (Arcade, Supademo): clickable walkthroughs instead of video.
Most teams record the voiceover separately and lay it over the finished capture, as here.
