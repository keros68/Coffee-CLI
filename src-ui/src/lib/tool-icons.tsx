// Shared synchronous tool-icon registry used across Launchpad cards,
// Chrome tabs, Gambit workspace chips, and the right-hand HistoryBoard.
//
// PNGs use `?inline` -> base64 data URI rendered via CSS `background-image`;
// SVGs use `?raw` -> inline markup rendered via `dangerouslySetInnerHTML`.
// Both avoid `<img>` async-decode flashes on WebView2 re-mounts.

import type { CSSProperties, ReactNode } from 'react';

import CLAUDE_SVG from '../icons-inline/claude.svg?raw';
import MIMOCODE_DATA_URL from '../icons-inline/mimocode.png?inline';
import HERMES_DATA_URL from '../icons-inline/hermes.png?inline';
import TERMINAL_MAC_DATA_URL from '../icons-inline/terminal-macos.png?inline';
import TERMINAL_LINUX_DATA_URL from '../icons-inline/terminal-linux.png?inline';
import TERMINAL_PWSH_SVG from '../icons-inline/terminal-powershell.svg?raw';
import PI_SVG from '../icons-inline/pi.svg?raw';
import COPILOT_SVG from '../icons-inline/copilot.svg?raw';
import GROK_SVG from '../icons-inline/grok.svg?raw';
import OPENCLAW_SVG from '../icons-inline/openclaw.svg?raw';
import KILO_SVG from '../icons-inline/kilo.svg?raw';
import CURSOR_SVG from '../icons-inline/cursor.svg?raw';
import CLINE_SVG from '../icons-inline/cline.svg?raw';
import OMP_SVG from '../icons-inline/omp.svg?raw';
import CODEBUDDY_SVG from '../icons-inline/codebuddy.svg?raw';
import MUSE_DATA_URL from '../icons-inline/muse.png?inline';
import KIRO_SVG from '../icons-inline/kiro.svg?raw';
import MINIMAX_SVG from '../icons-inline/minimax.svg?raw';
import AIDER_DATA_URL from '../icons-inline/aider.png?inline';
import KIMICODE_DATA_URL from '../icons-inline/kimicode.png?inline';
import CRUSH_DATA_URL from '../icons-inline/crush.png?inline';
import GOOSE_DATA_URL from '../icons-inline/goose.png?inline';

const bgIcon = (dataUrl: string, size = '1em', extra: CSSProperties = {}) => (
  <span
    aria-hidden
    style={{
      display: 'inline-block',
      width: size,
      height: size,
      flexShrink: 0,
      backgroundImage: `url(${dataUrl})`,
      backgroundSize: 'contain',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      ...extra,
    }}
  />
);

const CODEX_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%"><defs><linearGradient gradientUnits="userSpaceOnUse" id="codex-fill" x1="12" x2="12" y1="3" y2="21"><stop stop-color="#B1A7FF"/><stop offset=".5" stop-color="#7A9DFF"/><stop offset="1" stop-color="#3941FF"/></linearGradient></defs><path d="M19.503 0H4.496A4.496 4.496 0 000 4.496v15.007A4.496 4.496 0 004.496 24h15.007A4.496 4.496 0 0024 19.503V4.496A4.496 4.496 0 0019.503 0z" fill="#fff"/><path d="M9.064 3.344a4.578 4.578 0 012.285-.312c1 .115 1.891.54 2.673 1.275.01.01.024.017.037.021a.09.09 0 00.043 0 4.55 4.55 0 013.046.275l.047.022.116.057a4.581 4.581 0 012.188 2.399c.209.51.313 1.041.315 1.595a4.24 4.24 0 01-.134 1.223.123.123 0 00.03.115c.594.607.988 1.33 1.183 2.17.289 1.425-.007 2.71-.887 3.854l-.136.166a4.548 4.548 0 01-2.201 1.388.123.123 0 00-.081.076c-.191.551-.383 1.023-.74 1.494-.9 1.187-2.222 1.846-3.711 1.838-1.187-.006-2.239-.44-3.157-1.302a.107.107 0 00-.105-.024c-.388.125-.78.143-1.204.138a4.441 4.441 0 01-1.945-.466 4.544 4.544 0 01-1.61-1.335c-.152-.202-.303-.392-.414-.617a5.81 5.81 0 01-.37-.961 4.582 4.582 0 01-.014-2.298.124.124 0 00.006-.056.085.085 0 00-.027-.048 4.467 4.467 0 01-1.034-1.651 3.896 3.896 0 01-.251-1.192 5.189 5.189 0 01.141-1.6c.337-1.112.982-1.985 1.933-2.618.212-.141.413-.251.601-.33.215-.089.43-.164.646-.227a.098.098 0 00.065-.066 4.51 4.51 0 01.829-1.615 4.535 4.535 0 011.837-1.388zm3.482 10.565a.637.637 0 000 1.272h3.636a.637.637 0 100-1.272h-3.636zM8.462 9.23a.637.637 0 00-1.106.631l1.272 2.224-1.266 2.136a.636.636 0 101.095.649l1.454-2.455a.636.636 0 00.005-.64L8.462 9.23z" fill="url(#codex-fill)"/></svg>';
const ANTIGRAVITY_SVG = '<svg height="100%" style="flex:none;line-height:1" viewBox="0 0 24 24" width="100%" xmlns="http://www.w3.org/2000/svg"><title>Antigravity</title><mask height="23" id="lobe-icons-antigravity-0-_R_0_" maskUnits="userSpaceOnUse" width="24" x="0" y="1"><path d="M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z" fill="#fff"></path></mask><g mask="url(#lobe-icons-antigravity-0-_R_0_)"><g filter="url(#lobe-icons-antigravity-1-_R_0_)"><path d="M-1.018-3.992c-.408 3.591 2.686 6.89 6.91 7.37 4.225.48 7.98-2.043 8.387-5.633.408-3.59-2.686-6.89-6.91-7.37-4.225-.479-7.98 2.043-8.387 5.633z" fill="#FFE432"></path></g><g filter="url(#lobe-icons-antigravity-2-_R_0_)"><path d="M15.269 7.747c1.058 4.557 5.691 7.374 10.348 6.293 4.657-1.082 7.575-5.653 6.516-10.21-1.058-4.556-5.691-7.374-10.348-6.292-4.657 1.082-7.575 5.653-6.516 10.21z" fill="#FC413D"></path></g><g filter="url(#lobe-icons-antigravity-3-_R_0_)"><path d="M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z" fill="#00B95C"></path></g><g filter="url(#lobe-icons-antigravity-4-_R_0_)"><path d="M-12.443 10.804c1.338 4.703 7.36 7.11 13.453 5.378 6.092-1.733 9.947-6.95 8.61-11.652C8.282-.173 2.26-2.58-3.833-.848-9.925.884-13.78 6.1-12.443 10.804z" fill="#00B95C"></path></g><g filter="url(#lobe-icons-antigravity-5-_R_0_)"><path d="M-7.608 14.703c3.352 3.424 9.126 3.208 12.896-.483 3.77-3.69 4.108-9.459.756-12.883C2.69-2.087-3.083-1.871-6.853 1.82c-3.77 3.69-4.108 9.458-.755 12.883z" fill="#00B95C"></path></g><g filter="url(#lobe-icons-antigravity-6-_R_0_)"><path d="M9.932 27.617c1.04 4.482 5.384 7.303 9.7 6.3 4.316-1.002 6.971-5.448 5.93-9.93-1.04-4.483-5.384-7.304-9.7-6.301-4.316 1.002-6.971 5.448-5.93 9.93z" fill="#3186FF"></path></g><g filter="url(#lobe-icons-antigravity-7-_R_0_)"><path d="M2.572-8.185C.392-3.329 2.778 2.472 7.9 4.771c5.122 2.3 11.042.227 13.222-4.63 2.18-4.855-.205-10.656-5.327-12.955-5.122-2.3-11.042-.227-13.222 4.63z" fill="#FBBC04"></path></g><g filter="url(#lobe-icons-antigravity-8-_R_0_)"><path d="M-3.267 38.686c-5.277-2.072 3.742-19.117 5.984-24.83 2.243-5.712 8.34-8.664 13.616-6.592 5.278 2.071 11.533 13.482 9.29 19.195-2.242 5.713-23.613 14.298-28.89 12.227z" fill="#3186FF"></path></g><g filter="url(#lobe-icons-antigravity-9-_R_0_)"><path d="M28.71 17.471c-1.413 1.649-5.1.808-8.236-1.878-3.135-2.687-4.531-6.201-3.118-7.85 1.412-1.649 5.1-.808 8.235 1.878s4.532 6.2 3.119 7.85z" fill="#749BFF"></path></g><g filter="url(#lobe-icons-antigravity-10-_R_0_)"><path d="M18.163 9.077c5.81 3.93 12.502 4.19 14.946.577 2.443-3.612-.287-9.727-6.098-13.658-5.81-3.931-12.502-4.19-14.946-.577-2.443 3.612.287 9.727 6.098 13.658z" fill="#FC413D"></path></g><g filter="url(#lobe-icons-antigravity-11-_R_0_)"><path d="M-.915 2.684c-1.44 3.473-.97 6.967 1.05 7.804 2.02.837 4.824-1.3 6.264-4.772 1.44-3.473.97-6.967-1.05-7.804-2.02-.837-4.824 1.3-6.264 4.772z" fill="#FFEE48"></path></g></g><defs><filter color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" height="17.587" id="lobe-icons-antigravity-1-_R_0_" width="19.838" x="-3.288" y="-11.917"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="1.117"></feGaussianBlur></filter><filter color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" height="38.565" id="lobe-icons-antigravity-2-_R_0_" width="38.9" x="4.251" y="-13.493"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="5.4"></feGaussianBlur></filter><filter color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" height="36.517" id="lobe-icons-antigravity-3-_R_0_" width="40.955" x="-21.889" y="-10.592"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="4.591"></feGaussianBlur></filter><filter color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" height="36.517" id="lobe-icons-antigravity-4-_R_0_" width="40.955" x="-21.889" y="-10.592"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="4.591"></feGaussianBlur></filter><filter color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" height="36.595" id="lobe-icons-antigravity-5-_R_0_" width="36.632" x="-19.099" y="-10.278"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="4.591"></feGaussianBlur></filter><filter color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" height="34.087" id="lobe-icons-antigravity-6-_R_0_" width="33.533" x=".981" y="8.758"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="4.363"></feGaussianBlur></filter><filter color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" height="35.276" id="lobe-icons-antigravity-7-_R_0_" width="35.978" x="-6.143" y="-21.659"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="3.954"></feGaussianBlur></filter><filter color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" height="46.523" id="lobe-icons-antigravity-8-_R_0_" width="45.114" x="-11.96" y="-.46"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="3.531"></feGaussianBlur></filter><filter color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" height="24.054" id="lobe-icons-antigravity-9-_R_0_" width="25.094" x="10.485" y=".58"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="3.159"></feGaussianBlur></filter><filter color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" height="30.007" id="lobe-icons-antigravity-10-_R_0_" width="33.508" x="5.833" y="-12.467"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="2.669"></feGaussianBlur></filter><filter color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse" height="26.151" id="lobe-icons-antigravity-11-_R_0_" width="22.194" x="-8.355" y="-8.876"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape"></feBlend><feGaussianBlur result="effect1_foregroundBlur_977_115" stdDeviation="3.303"></feGaussianBlur></filter></defs></svg>';
const OPENCODE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width="100%" height="100%"><rect width="96" height="96" rx="18" ry="18" fill="#131010"/><rect x="24" y="18" width="48" height="60" fill="#FFFFFF"/><rect x="36" y="30" width="24" height="36" fill="#5A5858"/><rect x="36" y="30" width="24" height="12" fill="#131010"/></svg>';
const QWEN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100%" height="100%"><defs><linearGradient id="qwen-fill" x1="0%" x2="100%" y1="0%" y2="0%"><stop offset="0%" stop-color="#6336E7" stop-opacity=".84"/><stop offset="100%" stop-color="#6F69F7" stop-opacity=".84"/></linearGradient></defs><path d="M12.604 1.34c.393.69.784 1.382 1.174 2.075a.18.18 0 00.157.091h5.552c.174 0 .322.11.446.327l1.454 2.57c.19.337.24.478.024.837-.26.43-.513.864-.76 1.3l-.367.658c-.106.196-.223.28-.04.512l2.652 4.637c.172.301.111.494-.043.77-.437.785-.882 1.564-1.335 2.34-.159.272-.352.375-.68.37-.777-.016-1.552-.01-2.327.016a.099.099 0 00-.081.05 575.097 575.097 0 01-2.705 4.74c-.169.293-.38.363-.725.364-.997.003-2.002.004-3.017.002a.537.537 0 01-.465-.271l-1.335-2.323a.09.09 0 00-.083-.049H4.982c-.285.03-.553-.001-.805-.092l-1.603-2.77a.543.543 0 01-.002-.54l1.207-2.12a.198.198 0 000-.197 550.951 550.951 0 01-1.875-3.272l-.79-1.395c-.16-.31-.173-.496.095-.965.465-.813.927-1.625 1.387-2.436.132-.234.304-.334.584-.335a338.3 338.3 0 012.589-.001.124.124 0 00.107-.063l2.806-4.895a.488.488 0 01.422-.246c.524-.001 1.053 0 1.583-.006L11.704 1c.341-.003.724.032.9.34zm-3.432.403a.06.06 0 00-.052.03L6.254 6.788a.157.157 0 01-.135.078H3.253c-.056 0-.07.025-.041.074l5.81 10.156c.025.042.013.062-.034.063l-2.795.015a.218.218 0 00-.2.116l-1.32 2.31c-.044.078-.021.118.068.118l5.716.008c.046 0 .08.02.104.061l1.403 2.454c.046.081.092.082.139 0l5.006-8.76.783-1.382a.055.055 0 01.096 0l1.424 2.53a.122.122 0 00.107.062l2.763-.02a.04.04 0 00.035-.02.041.041 0 000-.04l-2.9-5.086a.108.108 0 010-.113l.293-.507 1.12-1.977c.024-.041.012-.062-.035-.062H9.2c-.059 0-.073-.026-.043-.077l1.434-2.505a.107.107 0 000-.114L9.225 1.774a.06.06 0 00-.053-.031zm6.29 8.02c.046 0 .058.02.034.06l-.832 1.465-2.613 4.585a.056.056 0 01-.05.029.058.058 0 01-.05-.029L8.498 9.841c-.02-.034-.01-.052.028-.054l.216-.012 6.722-.012z" fill="url(#qwen-fill)" fill-rule="nonzero"/></svg>';

const inlineSvgIcon = (markup: string, size = '1em', extra: CSSProperties = {}) => (
  <span
    aria-hidden
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      flexShrink: 0,
      ...extra,
    }}
    dangerouslySetInnerHTML={{ __html: markup }}
  />
);

const SvgClaude      = () => inlineSvgIcon(CLAUDE_SVG);
const SvgQwen        = () => inlineSvgIcon(QWEN_SVG);
const SvgOpenCode    = () => inlineSvgIcon(OPENCODE_SVG);
const SvgMimo        = () => bgIcon(MIMOCODE_DATA_URL, '1em', { borderRadius: 'var(--radius-xs)' });
const SvgKilo        = () => inlineSvgIcon(KILO_SVG, '1em', { borderRadius: 'var(--radius-xs)', overflow: 'hidden' });
const SvgOpenClaw    = () => inlineSvgIcon(OPENCLAW_SVG);
const SvgCodex       = () => inlineSvgIcon(CODEX_SVG);
const SvgAntigravity = () => inlineSvgIcon(ANTIGRAVITY_SVG);
const SvgHermes      = () => bgIcon(HERMES_DATA_URL, '1em', { borderRadius: 'var(--radius-xs)', backgroundSize: 'cover' });
const SvgPi          = () => inlineSvgIcon(PI_SVG);
const SvgCopilot     = () => inlineSvgIcon(COPILOT_SVG);
const SvgGrok        = () => inlineSvgIcon(GROK_SVG);
const SvgAider       = () => bgIcon(AIDER_DATA_URL, '1em', { borderRadius: 'var(--radius-xs)' });
const SvgKimi        = () => bgIcon(KIMICODE_DATA_URL, '1em', { borderRadius: 'var(--radius-xs)' });
const SvgCrush       = () => bgIcon(CRUSH_DATA_URL, '1em', { borderRadius: 'var(--radius-xs)' });
const SvgGoose       = () => bgIcon(GOOSE_DATA_URL, '1em', {
  backgroundImage: 'none',
  backgroundColor: 'currentColor',
  WebkitMask: `url(${GOOSE_DATA_URL}) center / contain no-repeat`,
  mask: `url(${GOOSE_DATA_URL}) center / contain no-repeat`,
});
const SvgCursor      = () => inlineSvgIcon(CURSOR_SVG);
const SvgCline       = () => inlineSvgIcon(CLINE_SVG);
const SvgOmp         = () => inlineSvgIcon(OMP_SVG);
const SvgCodeBuddy   = () => inlineSvgIcon(CODEBUDDY_SVG);
const SvgMuse        = () => bgIcon(MUSE_DATA_URL);
const SvgKiro        = () => inlineSvgIcon(KIRO_SVG);
const SvgMiniMax     = () => inlineSvgIcon(MINIMAX_SVG);

export const SvgTwoSplit = () => (
  <svg
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    style={{ flexShrink: 0, color: 'var(--accent)', verticalAlign: '-0.125em' }}
  >
    <rect x="4" y="4" width="7.5" height="16" />
    <rect x="12.5" y="4" width="7.5" height="16" />
  </svg>
);

export const SvgThreeSplit = () => (
  <svg
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    style={{ flexShrink: 0, color: 'var(--accent)', verticalAlign: '-0.125em' }}
  >
    <rect x="3.5" y="4" width="5" height="16" />
    <rect x="9.5" y="4" width="5" height="16" />
    <rect x="15.5" y="4" width="5" height="16" />
  </svg>
);

export const SvgFourSplit = () => (
  <svg
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="none"
    style={{ flexShrink: 0, color: 'var(--accent)', verticalAlign: '-0.125em' }}
  >
    <rect x="4" y="4" width="7.5" height="7.5" />
    <rect x="12.5" y="4" width="7.5" height="7.5" />
    <rect x="4" y="12.5" width="7.5" height="7.5" />
    <rect x="12.5" y="12.5" width="7.5" height="7.5" />
  </svg>
);

const detectOS = (): 'win' | 'mac' | 'linux' => {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : 'win';
  if (ua.includes('win')) return 'win';
  if (ua.includes('mac')) return 'mac';
  return 'linux';
};

export const TerminalIcon = () => {
  const os = detectOS();
  if (os === 'win') return inlineSvgIcon(TERMINAL_PWSH_SVG, '1em', { borderRadius: 'var(--radius-xs)' });
  const dataUrl = os === 'mac' ? TERMINAL_MAC_DATA_URL : TERMINAL_LINUX_DATA_URL;
  return bgIcon(dataUrl, '1em', { borderRadius: 'var(--radius-xs)' });
};

/** Canonical tool -> glyph resolver for all 23 AI CLIs plus terminal/split views.
 *  Returns `undefined` for unknown/placeholder tools so callers can supply their
 *  own context-specific fallback (e.g. `SvgPlus` in tab bar, neutral badge in HistoryBoard). */
export function getToolIcon(tool: string | null | undefined): ReactNode {
  switch (tool) {
    case 'claude': return <SvgClaude />;
    case 'qwen': return <SvgQwen />;
    case 'hermes': return <SvgHermes />;
    case 'opencode': return <SvgOpenCode />;
    case 'mimocode': return <SvgMimo />;
    case 'kilo': return <SvgKilo />;
    case 'openclaw': return <SvgOpenClaw />;
    case 'codex': return <SvgCodex />;
    case 'grok': return <SvgGrok />;
    case 'antigravity': return <SvgAntigravity />;
    case 'pi': return <SvgPi />;
    case 'crush': return <SvgCrush />;
    case 'aider': return <SvgAider />;
    case 'kimicode': return <SvgKimi />;
    case 'goose': return <SvgGoose />;
    case 'copilot': return <SvgCopilot />;
    case 'cursor': return <SvgCursor />;
    case 'cline': return <SvgCline />;
    case 'omp': return <SvgOmp />;
    case 'codebuddy': return <SvgCodeBuddy />;
    case 'muse': return <SvgMuse />;
    case 'kiro': return <SvgKiro />;
    case 'minimax': return <SvgMiniMax />;
    case 'remote':
    case 'terminal': return <TerminalIcon />;
    case 'two-split': return <SvgTwoSplit />;
    case 'three-split': return <SvgThreeSplit />;
    case 'four-split': return <SvgFourSplit />;
    default: return undefined;
  }
}
