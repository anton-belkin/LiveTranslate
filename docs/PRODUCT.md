# LiveTranslate — Product spec (PoC)

## One-liner
A low-latency browser app that captures meeting audio, transcribes speech in real time, and shows bilingual (DE↔EN) text in two columns so participants can follow a live conversation across languages.

## Primary user story
During a live meeting with German- and English-speaking participants, the user opens LiveTranslate, grants microphone access, and sees a continuously updating bilingual transcript that separates turns so replies from different speakers don’t merge.

## Core flow
1) User clicks Start
2) Browser asks for microphone permission
3) App streams microphone audio to server
4) Server performs streaming speech-to-text (interim + final)
5) Server translates DE→EN and EN→DE (streaming when possible)
6) Browser UI renders a two-column transcript with clear turn blocks

## Audio capture strategy (PoC)
- **Default**: capture **microphone** audio (`getUserMedia({ audio: true })`) to work across Zoom/Teams desktop apps.
- **Optional later**:
  - capture browser **tab audio** (`getDisplayMedia({ audio: true })`) when meetings run in a tab
  - mix multiple sources (mic + tab/system) via WebAudio if needed
- Note: On macOS, some users observe the built-in microphone input can include system output when using built-in speakers; we treat this as a helpful environment property, not a guaranteed platform feature.

## UX requirements
- Two columns: Deutsch (LANG1) and English (LANG2)
- Turn/phrase separation:
  - consecutive speakers/phrases appear as separate blocks
  - do not merge rapid turn-taking into one paragraph
- Partial vs final:
  - show interim STT quickly, then finalize segments
  - translation appears shortly after (ideally streamed)
- Color coding:
  - original text styled as “original”
  - translated text styled as “translation”

## Latency requirements (guiding targets)
- STT partial should appear as fast as possible (human-perceivable “live”)
- Translation should follow quickly; small lag is acceptable but should not block STT display

## Nice-to-have (later)
- Translate incomplete sentences and revise as the speaker continues
- Speaker diarization (speaker labels) if the provider supports it

## Privacy constraints (PoC)
- No storage by default (no persistence of audio/transcripts)
- All API keys server-side only
- UI should clearly disclose audio is sent to cloud providers

