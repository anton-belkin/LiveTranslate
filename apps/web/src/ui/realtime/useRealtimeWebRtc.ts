import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Lang } from "@livetranslate/shared";

import type { OpenAiRealtimeEvent, TranscriptAction } from "./store";

type Status = "idle" | "connecting" | "open" | "closed" | "error";

type TokenResponse = { value?: string } & Record<string, any>;

function getTokenUrl() {
  const fromEnv = import.meta.env.VITE_TOKEN_URL;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  return "http://localhost:8787/token";
}

function otherDeEn(lang: Lang): Lang {
  return lang === "de" ? "en" : "de";
}

function detectDeEnHeuristic(text: string): Lang | null {
  const t = text.trim();
  if (t.length < 12) return null;
  if (/[äöüß]/i.test(t)) return "de";
  const lower = ` ${t.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const deHits = [" und ", " ich ", " nicht ", " das ", " ist ", " wir ", " sie ", " aber "];
  const enHits = [" the ", " and ", " i ", " you ", " not ", " this ", " that ", " we ", " but "];
  const deScore = deHits.reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0);
  const enScore = enHits.reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0);
  if (deScore >= 2 && deScore > enScore) return "de";
  if (enScore >= 2 && enScore > deScore) return "en";
  return null;
}

type TranslatePatch = {
  segment_id: string;
  target_lang: Lang;
  target_text: string;
  source_rev: number;
};

function parseTranslatePatch(argsJson: string): TranslatePatch | null {
  try {
    const obj = JSON.parse(argsJson) as any;
    const segment_id = String(obj?.segment_id ?? "");
    const target_lang = obj?.target_lang === "de" || obj?.target_lang === "en" ? obj.target_lang : null;
    const target_text = String(obj?.target_text ?? "");
    const source_rev = Number(obj?.source_rev);
    if (!segment_id || !target_lang || !Number.isFinite(source_rev)) return null;
    return { segment_id, target_lang, target_text, source_rev };
  } catch {
    return null;
  }
}

export function useRealtimeWebRtc(args: {
  dispatch: (action: TranscriptAction) => void;
  /**
   * Used to read current segment rev/text without wiring store selectors.
   * Best-effort; stale reads just drop patches.
   */
  getSegment: (segmentId: string) => { sourceText: string; rev: number; sourceLang?: Lang } | undefined;
  columnLangs: Lang[];
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [lastError, setLastError] = useState<string>("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const connectRunIdRef = useRef(0);
  const connectInFlightRef = useRef(false);
  const disconnectRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const eventLogCountRef = useRef(0);
  const parseErrorCountRef = useRef(0);

  const translateTimersRef = useRef<Map<string, number>>(new Map());

  const tokenUrl = useMemo(() => getTokenUrl(), []);

  const clearTranslateTimer = useCallback((segmentId: string) => {
    const t = translateTimersRef.current.get(segmentId);
    if (!t) return;
    window.clearTimeout(t);
    translateTimersRef.current.delete(segmentId);
  }, []);

  const sendEvent = useCallback((evt: unknown) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return false;
    try {
      dc.send(JSON.stringify(evt));
      return true;
    } catch {
      return false;
    }
  }, []);

  const ensureSessionTools = useCallback(() => {
    // Tool used for structured translation patches.
    sendEvent({
      type: "session.update",
      session: {
        type: "realtime",
        tools: [
          {
            type: "function",
            name: "segment_translation_patch",
            description:
              "Emit a translation update for a single transcription segment. " +
              "This must be called exactly once per response.",
            parameters: {
              type: "object",
              strict: true,
              properties: {
                segment_id: { type: "string" },
                target_lang: { type: "string", enum: ["de", "en"] },
                target_text: { type: "string" },
                source_rev: { type: "integer" },
              },
              required: ["segment_id", "target_lang", "target_text", "source_rev"],
            },
          },
        ],
        tool_choice: "auto",
      },
    });
  }, [sendEvent]);

  const requestTranslationForSegment = useCallback(
    (segmentId: string) => {
      const seg = args.getSegment(segmentId);
      if (!seg) return;
      const text = seg.sourceText.trim();
      if (!text) return;

      const from = seg.sourceLang ?? detectDeEnHeuristic(text) ?? null;
      if (!from) return;

      const [lang1, lang2] = args.columnLangs;
      // Translate into the other column language (DE/EN only for now).
      const to = from === lang1 ? lang2 : from === lang2 ? lang1 : otherDeEn(from);

      sendEvent({
        type: "response.create",
        response: {
          conversation: "none",
          output_modalities: ["text"],
          instructions:
            `Translate from ${from === "de" ? "German" : "English"} to ${to === "de" ? "German" : "English"}.\n` +
            "Do NOT include any commentary. Do NOT quote.\n" +
            "When done, call the function `segment_translation_patch` exactly once with:\n" +
            `- segment_id: "${segmentId}"\n` +
            `- target_lang: "${to}"\n` +
            "- target_text: the full translated text\n" +
            `- source_rev: ${seg.rev}\n`,
          input: [
            {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text }],
            },
          ],
        },
      });
    },
    [args, sendEvent],
  );

  const scheduleTranslation = useCallback(
    (segmentId: string) => {
      clearTranslateTimer(segmentId);
      const t = window.setTimeout(() => {
        translateTimersRef.current.delete(segmentId);
        requestTranslationForSegment(segmentId);
      }, 850);
      translateTimersRef.current.set(segmentId, t);
    },
    [clearTranslateTimer, requestTranslationForSegment],
  );

  const handleServerEvent = useCallback(
    (evt: OpenAiRealtimeEvent) => {
      args.dispatch({ type: "realtime.event", event: evt });

      // #region agent log
      if (eventLogCountRef.current < 25) {
        eventLogCountRef.current += 1;
        fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useRealtimeWebRtc.ts:handleServerEvent',message:'server event',data:{idx:eventLogCountRef.current,type:evt?.type ?? null,keys:Object.keys(evt ?? {}).slice(0,8)},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'G'})}).catch(()=>{});
      }
      // #endregion

      // Translation patch via tool call arguments.
      if (evt?.type === "response.function_call_arguments.done") {
        const name = String((evt as any).name ?? "");
        if (name === "segment_translation_patch") {
          const patch = parseTranslatePatch(String((evt as any).arguments ?? ""));
          if (!patch) return;
          args.dispatch({
            type: "translation.patch",
            patch: {
              segmentId: patch.segment_id,
              targetLang: patch.target_lang,
              targetText: patch.target_text,
              sourceRev: patch.source_rev,
            },
          });
        }
        return;
      }

      // Schedule translation when a diarized segment arrives/updates.
      if (evt?.type === "conversation.item.input_audio_transcription.segment") {
        const segmentId = String((evt as any).id ?? "");
        if (!segmentId) return;
        scheduleTranslation(segmentId);
        return;
      }

      if (evt?.type === "conversation.item.input_audio_transcription.delta") {
        const itemId = String((evt as any).item_id ?? "");
        const contentIndex = Number.isFinite(Number((evt as any).content_index))
          ? Number((evt as any).content_index)
          : 0;
        if (!itemId) return;
        scheduleTranslation(`item_${itemId}:c${contentIndex}`);
        return;
      }

      if (evt?.type === "conversation.item.input_audio_transcription.completed") {
        const itemId = String((evt as any).item_id ?? "");
        const contentIndex = Number.isFinite(Number((evt as any).content_index))
          ? Number((evt as any).content_index)
          : 0;
        if (!itemId) return;
        scheduleTranslation(`item_${itemId}:c${contentIndex}`);
        return;
      }
    },
    [args, scheduleTranslation],
  );

  const connect = useCallback(async () => {
    if (status === "connecting" || status === "open") return;
    setLastError("");
    setStatus("connecting");
    args.dispatch({ type: "conn.update", status: "connecting" });

    connectRunIdRef.current += 1;
    const run = connectRunIdRef.current;
    connectInFlightRef.current = true;
    let step = "init";
    const t0 = Date.now();
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useRealtimeWebRtc.ts:connect:entry',message:'connect() entry',data:{run,status,hasPc:!!pcRef.current,hasDc:!!dcRef.current,dcState:dcRef.current?.readyState ?? null,isSecureContext:typeof window!=="undefined"?(window as any).isSecureContext:null,vis:typeof document!=="undefined"?document.visibilityState:null,ua:typeof navigator!=="undefined"?navigator.userAgent.slice(0,80):null,userActivation:(navigator as any)?.userActivation?{isActive:(navigator as any).userActivation.isActive,hasBeenActive:(navigator as any).userActivation.hasBeenActive}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'B'})}).catch(()=>{});
    // #endregion

    try {
      step = "fetch_token";
      const tokenRes = await fetch(tokenUrl, { method: "GET" });
      const tokenJson = (await tokenRes.json()) as TokenResponse;
      const ephemeralKey = String(tokenJson?.value ?? "");
      if (!ephemeralKey) throw new Error("Token endpoint did not return `value`.");
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useRealtimeWebRtc.ts:connect:token',message:'token fetched',data:{ok:tokenRes.ok,status:tokenRes.status,tokenLen:ephemeralKey.length},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      step = "create_pc";
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useRealtimeWebRtc.ts:connect:pc',message:'pc created',data:{signalingState:pc.signalingState,connectionState:pc.connectionState},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'B'})}).catch(()=>{});
      // #endregion

      pc.onconnectionstatechange = () => {
        const s = pc.connectionState;
        if (s === "failed" || s === "disconnected") {
          setStatus("error");
          args.dispatch({ type: "conn.update", status: "error", error: `WebRTC ${s}` });
        }
      };

      step = "create_dc";
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.addEventListener("open", () => {
        setStatus("open");
        args.dispatch({ type: "conn.update", status: "open" });
        ensureSessionTools();
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useRealtimeWebRtc.ts:dc:open',message:'data channel open',data:{readyState:dc.readyState,label:dc.label},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'G'})}).catch(()=>{});
        // #endregion
      });

      dc.addEventListener("message", (e) => {
        try {
          const evt = JSON.parse(String((e as MessageEvent).data ?? "")) as OpenAiRealtimeEvent;
          handleServerEvent(evt);
        } catch {
          parseErrorCountRef.current += 1;
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useRealtimeWebRtc.ts:dc:message:parse_error',message:'failed to parse event',data:{count:parseErrorCountRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'G'})}).catch(()=>{});
          // #endregion
          // ignore
        }
      });

      // Mic track
      step = "get_user_media";
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useRealtimeWebRtc.ts:connect:before_gum',message:'before getUserMedia',data:{run,elapsedMs:Date.now()-t0,vis:document.visibilityState,hasMediaDevices:!!navigator.mediaDevices,hasGum:!!navigator.mediaDevices?.getUserMedia,hasEnumerate:!!navigator.mediaDevices?.enumerateDevices,userActivation:(navigator as any)?.userActivation?{isActive:(navigator as any).userActivation.isActive,hasBeenActive:(navigator as any).userActivation.hasBeenActive}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'E'})}).catch(()=>{});
      // #endregion
      let ms: MediaStream;
      try {
        ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        const e = err as any;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useRealtimeWebRtc.ts:connect:getUserMedia:catch',message:'getUserMedia threw',data:{run,elapsedMs:Date.now()-t0,name:String(e?.name??''),message:String(e?.message??''),code:typeof e?.code==='number'?e.code:null},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        throw err;
      }
      micStreamRef.current = ms;
      const track = ms.getTracks()[0];
      if (track) pc.addTrack(track, ms);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useRealtimeWebRtc.ts:connect:mic',message:'mic acquired',data:{tracks:ms.getTracks().length,trackKinds:ms.getTracks().map(t=>t.kind)},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'C'})}).catch(()=>{});
      // #endregion

      step = "create_offer";
      const offer = await pc.createOffer();
      step = "set_local_description";
      await pc.setLocalDescription(offer);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useRealtimeWebRtc.ts:connect:offer',message:'local description set',data:{signalingState:pc.signalingState,hasLocalSdp:!!pc.localDescription?.sdp,localSdpLen:pc.localDescription?.sdp?pc.localDescription.sdp.length:0},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'B'})}).catch(()=>{});
      // #endregion

      step = "sdp_exchange";
      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp ?? "",
      });
      if (!sdpRes.ok) {
        const body = await sdpRes.text().catch(() => "");
        throw new Error(`Realtime SDP exchange failed: ${sdpRes.status} ${sdpRes.statusText}${body ? ` - ${body}` : ""}`);
      }
      const answerSdp = await sdpRes.text();
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useRealtimeWebRtc.ts:connect:sdp',message:'sdp answer received',data:{status:sdpRes.status,answerLen:answerSdp.length,hasLocation:!!sdpRes.headers.get('Location')},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'D'})}).catch(()=>{});
      // #endregion

      step = "set_remote_description";
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastError(msg);
      setStatus("error");
      args.dispatch({ type: "conn.update", status: "error", error: msg });
      const name = e instanceof Error ? e.name : "";
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useRealtimeWebRtc.ts:connect:catch',message:'connect() failed',data:{run,step,elapsedMs:Date.now()-t0,errorName:name,errorMessage:msg,vis:typeof document!=="undefined"?document.visibilityState:null,userActivation:(navigator as any)?.userActivation?{isActive:(navigator as any).userActivation.isActive,hasBeenActive:(navigator as any).userActivation.hasBeenActive}:null,pcSignaling:pcRef.current?.signalingState ?? null,pcConn:pcRef.current?.connectionState ?? null,dcState:dcRef.current?.readyState ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
    } finally {
      connectInFlightRef.current = false;
    }
  }, [args, ensureSessionTools, handleServerEvent, status, tokenUrl]);

  const disconnect = useCallback(async () => {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useRealtimeWebRtc.ts:disconnect:entry',message:'disconnect() called',data:{status,connectInFlight:connectInFlightRef.current,hasPc:!!pcRef.current,hasDc:!!dcRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'F'})}).catch(()=>{});
    // #endregion
    setStatus("closed");
    args.dispatch({ type: "conn.update", status: "closed" });

    for (const [segmentId, t] of translateTimersRef.current) {
      window.clearTimeout(t);
      translateTimersRef.current.delete(segmentId);
    }

    try {
      dcRef.current?.close();
    } catch {
      // ignore
    }
    dcRef.current = null;

    try {
      pcRef.current?.close();
    } catch {
      // ignore
    }
    pcRef.current = null;

    const ms = micStreamRef.current;
    micStreamRef.current = null;
    try {
      ms?.getTracks().forEach((t) => t.stop());
    } catch {
      // ignore
    }
  }, [args]);

  useEffect(() => {
    disconnectRef.current = disconnect;
  }, [disconnect]);

  useEffect(() => {
    return () => {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useRealtimeWebRtc.ts:effect:cleanup',message:'hook cleanup -> disconnect()',data:{status,connectInFlight:connectInFlightRef.current},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      void disconnectRef.current();
    };
  }, []);

  return { status, lastError, connect, disconnect };
}

