"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  /** Path under /public, e.g. "/videos/hero-city-dusk.mp4" */
  src: string;
  /** Poster still shown before playback and whenever motion is disabled. */
  poster: string;
  /** Extra classes for the wrapper (position it absolutely in the section). */
  className?: string;
}

/**
 * Full-bleed ambient background video, SpaceX-style.
 *
 * - The poster image always renders first, so first paint never waits on video.
 * - The video src mounts only once the section nears the viewport AND the
 *   visitor has neither `prefers-reduced-motion` nor Save-Data enabled —
 *   reduced-motion visitors keep the still, and no bytes are wasted on
 *   sections never scrolled to.
 * - Playback pauses whenever the section leaves the viewport.
 * - Decorative only: muted, looped, inert, aria-hidden.
 */
export function BackgroundVideo({ src, poster, className = "" }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [wantsVideo, setWantsVideo] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    type SaveDataNavigator = Navigator & { connection?: { saveData?: boolean } };
    const saveData = (navigator as SaveDataNavigator).connection?.saveData === true;
    if (reducedMotion || saveData) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setWantsVideo(true);
            videoRef.current?.play().catch(() => {
              /* Autoplay can be declined; the poster remains. */
            });
          } else {
            videoRef.current?.pause();
          }
        }
      },
      { rootMargin: "25% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapRef} className={`bg-video-wrap ${className}`} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- decorative backdrop; next/image is disabled for static export */}
      <img src={poster} alt="" className="bg-video-media" draggable={false} />
      {wantsVideo && (
        <video
          ref={videoRef}
          className={`bg-video-media bg-video-motion ${playing ? "bg-video-motion--on" : ""}`}
          src={src}
          poster={poster}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          tabIndex={-1}
          onPlaying={() => setPlaying(true)}
        />
      )}
    </div>
  );
}
