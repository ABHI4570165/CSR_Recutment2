import { useEffect, useRef, useState, useCallback } from "react";
import { createProctorSocket } from "../socket/proctorSocket";
import { rtcConfig } from "./iceConfig";

/*
 * Admin side of live proctoring. Maintains the live roster of online students and,
 * for the ones the admin chooses to watch (only visible/expanded cards), pulls a
 * peer-to-peer webcam stream. Watching a student => emit admin:watch => the student
 * sends an offer => we answer => their track arrives.
 *
 * Security: only admins get this socket (JWT-checked server-side); a student can
 * never watch another student (students have no watch capability).
 */
export function useAdminProctor(adminToken) {
  const [status, setStatus] = useState("connecting");    // connecting | online | error
  const [students, setStudents] = useState(new Map());   // candidateId -> info
  const [streams, setStreams]   = useState(new Map());   // candidateId -> MediaStream
  const socketRef = useRef(null);
  const peersRef = useRef(new Map());                    // candidateId -> { pc, socketId }

  const upsert = (info) => setStudents((m) => new Map(m).set(info.candidateId, info));
  const remove = (candidateId) => {
    setStudents((m) => { const n = new Map(m); n.delete(candidateId); return n; });
    setStreams((m) => { const n = new Map(m); n.delete(candidateId); return n; });
    closePeer(candidateId);
  };

  const closePeer = (candidateId) => {
    const p = peersRef.current.get(candidateId);
    if (p) { try { p.pc.close(); } catch { /* noop */ } peersRef.current.delete(candidateId); }
  };

  useEffect(() => {
    if (!adminToken) return;
    const socket = createProctorSocket("admin", adminToken);
    socketRef.current = socket;

    socket.on("connect", () => setStatus("online"));
    socket.on("connect_error", () => setStatus("error"));
    socket.on("disconnect", () => setStatus("connecting"));

    socket.on("proctor:roster", (list) => setStudents(new Map(list.map((s) => [s.candidateId, s]))));
    socket.on("proctor:student-online", upsert);
    socket.on("proctor:student-update", upsert);
    socket.on("proctor:student-offline", ({ candidateId }) => remove(candidateId));

    // Student answered our watch request with an OFFER (they hold the media).
    socket.on("webrtc:offer", async ({ from, candidateId, sdp }) => {
      let entry = peersRef.current.get(candidateId);
      if (entry) closePeer(candidateId);
      const pc = new RTCPeerConnection(rtcConfig);
      entry = { pc, socketId: from };
      peersRef.current.set(candidateId, entry);

      pc.onicecandidate = (e) => { if (e.candidate) socket.emit("webrtc:ice", { to: from, candidate: e.candidate }); };
      pc.ontrack = (e) => {
        const stream = e.streams[0];
        setStreams((m) => new Map(m).set(candidateId, stream));
      };
      pc.onconnectionstatechange = () => {
        if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
          setStreams((m) => { const n = new Map(m); n.delete(candidateId); return n; });
        }
      };
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("webrtc:answer", { to: from, sdp: pc.localDescription });
      } catch { closePeer(candidateId); }
    });
    socket.on("webrtc:ice", async ({ from, candidate }) => {
      // find the peer whose remote socket is `from`
      for (const [cid, entry] of peersRef.current) {
        if (entry.socketId === from && candidate) {
          try { await entry.pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch { /* noop */ }
          break;
        }
      }
    });

    return () => {
      for (const cid of [...peersRef.current.keys()]) closePeer(cid);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [adminToken]);

  const watch = useCallback((candidateId, quality = "low") => {
    if (socketRef.current) socketRef.current.emit("admin:watch", { candidateId, quality });
  }, []);
  const unwatch = useCallback((candidateId) => {
    if (socketRef.current) socketRef.current.emit("admin:unwatch", { candidateId });
    closePeer(candidateId);
    setStreams((m) => { const n = new Map(m); n.delete(candidateId); return n; });
  }, []);

  return { status, students: [...students.values()], streams, watch, unwatch };
}
