const songFile = document.querySelector("#songFile");
const songName = document.querySelector("#songName");
const lyricsInput = document.querySelector("#lyricsInput");
const syncButton = document.querySelector("#syncButton");
const statusPanel = document.querySelector("#statusPanel");
const syncMode = document.querySelector("#syncMode");
const vocalStartInput = document.querySelector("#vocalStartInput");
const vocalEndInput = document.querySelector("#vocalEndInput");
const markVocalButton = document.querySelector("#markVocalButton");
const markVocalEndButton = document.querySelector("#markVocalEndButton");
const jumpVocalButton = document.querySelector("#jumpVocalButton");
const jumpVocalEndButton = document.querySelector("#jumpVocalEndButton");
const nudgeButtons = document.querySelectorAll(".nudge-button");
const startTapButton = document.querySelector("#startTapButton");
const tapLineButton = document.querySelector("#tapLineButton");
const undoTapButton = document.querySelector("#undoTapButton");
const finishTapButton = document.querySelector("#finishTapButton");
const loadSavedButton = document.querySelector("#loadSavedButton");
const tapProgress = document.querySelector("#tapProgress");
const saveStatus = document.querySelector("#saveStatus");
const saveBanner = document.querySelector("#saveBanner");
const audioPlayer = document.querySelector("#audioPlayer");
const waveform = document.querySelector("#waveform");
const trackTitle = document.querySelector("#trackTitle");
const previousLine = document.querySelector("#previousLine");
const activeLine = document.querySelector("#activeLine");
const nextLine = document.querySelector("#nextLine");
const timelineList = document.querySelector("#timelineList");
const exportJson = document.querySelector("#exportJson");
const exportLrc = document.querySelector("#exportLrc");

let audioBuffer = null;
let objectUrl = "";
let lyricMap = [];
let waveformPeaks = [];
let animationFrame = 0;
let vocalStart = 0;
let vocalEnd = 0;
let isScrubbingWaveform = false;
let tapMode = false;
let tapStarts = [];
let currentSongMeta = null;

songFile.addEventListener("change", loadSong);
lyricsInput.addEventListener("input", handleLyricsInput);
syncButton.addEventListener("click", generateSync);
markVocalButton.addEventListener("click", markFirstVocal);
markVocalEndButton.addEventListener("click", markLastVocal);
jumpVocalButton.addEventListener("click", jumpToFirstVocal);
jumpVocalEndButton.addEventListener("click", jumpToLastVocal);
nudgeButtons.forEach((button) => {
  button.addEventListener("click", () => nudgeFirstVocal(Number(button.dataset.nudge)));
});
startTapButton.addEventListener("click", startTapSync);
tapLineButton.addEventListener("click", tapNextLine);
undoTapButton.addEventListener("click", undoTap);
finishTapButton.addEventListener("click", finishTapSync);
loadSavedButton.addEventListener("click", loadSavedSync);
vocalStartInput.addEventListener("input", updateVocalStartFromInput);
vocalEndInput.addEventListener("input", updateVocalEndFromInput);
waveform.addEventListener("pointerdown", startWaveformScrub);
waveform.addEventListener("pointermove", scrubWaveform);
waveform.addEventListener("pointerup", stopWaveformScrub);
waveform.addEventListener("pointercancel", stopWaveformScrub);
audioPlayer.addEventListener("play", tick);
audioPlayer.addEventListener("pause", () => cancelAnimationFrame(animationFrame));
audioPlayer.addEventListener("seeked", () => {
  drawWaveform(audioPlayer.currentTime || 0);
  renderPlaybackState();
});
exportJson.addEventListener("click", () => downloadFile("lyricsync-timing.json", JSON.stringify(lyricMap, null, 2)));
exportLrc.addEventListener("click", () => downloadFile("lyricsync-timing.lrc", toLrc(lyricMap)));
document.addEventListener("keydown", handleKeyboardTap);
window.addEventListener("resize", () => drawWaveform(audioPlayer.currentTime || 0));

async function loadSong() {
  const file = songFile.files?.[0];
  if (!file) return;

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  audioPlayer.src = objectUrl;
  songName.textContent = file.name;
  trackTitle.textContent = file.name.replace(/\.[^.]+$/, "");
  currentSongMeta = {
    name: file.name,
    size: file.size,
    modified: file.lastModified,
  };
  vocalStart = 0;
  vocalEnd = 0;
  vocalStartInput.value = "0";
  vocalEndInput.value = "0";
  lyricMap = [];
  tapMode = false;
  tapStarts = [];
  updateSaveStatus(null);
  exportJson.disabled = true;
  exportLrc.disabled = true;
  timelineList.innerHTML = "";
  activeLine.textContent = "Mark the first and last sung lines for tighter sync.";
  previousLine.textContent = "";
  nextLine.textContent = "";
  statusPanel.textContent = "Reading the audio and preparing the waveform.";
  updateTapControls();

  try {
    const arrayBuffer = await file.arrayBuffer();
    const context = new AudioContext();
    audioBuffer = await context.decodeAudioData(arrayBuffer);
    await context.close();
    waveformPeaks = makeWaveformPeaks(audioBuffer, 900);
    drawWaveform(0);
    const restored = maybeRestoreSavedSync();
    if (!restored) {
      statusPanel.textContent = `${formatTime(audioBuffer.duration)} loaded. Mark the first sung line and, if there is an outro, the last sung line.`;
    }
  } catch (error) {
    audioBuffer = null;
    waveformPeaks = [];
    statusPanel.textContent = "This audio file could not be decoded in the browser. Try another format.";
  }

  updateReadyState();
}

function updateReadyState() {
  const hasLyrics = parseLyrics().length > 0;
  syncButton.disabled = !(audioBuffer && hasLyrics);
  startTapButton.disabled = !(audioBuffer && hasLyrics);
  markVocalButton.disabled = !audioBuffer;
  markVocalEndButton.disabled = !audioBuffer;
  jumpVocalButton.disabled = !audioBuffer;
  jumpVocalEndButton.disabled = !audioBuffer;
  nudgeButtons.forEach((button) => {
    button.disabled = !audioBuffer;
  });
  updateTapControls();
  maybeRestoreSavedSync();
}

function handleLyricsInput() {
  if (!tapMode) {
    lyricMap = [];
    tapStarts = [];
    timelineList.innerHTML = "";
    exportJson.disabled = true;
    exportLrc.disabled = true;
  }
  updateReadyState();
}

function parseLyrics() {
  return lyricsInput.value
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function generateSync() {
  if (!audioBuffer) return;

  const lines = parseLyrics();
  if (!lines.length) return;

  tapMode = false;
  tapStarts = [];
  const energy = analyzeEnergy(audioBuffer);
  const quietSections = findQuietSections(energy, audioBuffer.duration);
  const timings = makeLineTimings(lines, audioBuffer.duration, quietSections, syncMode.value, vocalStart, vocalEnd);

  lyricMap = timings.map((lineTiming, index) => ({
    index,
    line: lines[index],
    start: roundTime(lineTiming.start),
    end: roundTime(lineTiming.end),
  }));

  renderTimeline();
  renderPlaybackState();
  exportJson.disabled = false;
  exportLrc.disabled = false;
  statusPanel.textContent =
    `Sync generated from ${formatTime(vocalStart)} to ${formatTime(getEffectiveVocalEnd())}. Play the song to preview.`;
  updateTapControls();
}

function markFirstVocal() {
  if (!audioBuffer) return;

  setFirstVocal(audioPlayer.currentTime || 0);
  lyricMap = [];
  timelineList.innerHTML = "";
  exportJson.disabled = true;
  exportLrc.disabled = true;
  activeLine.textContent = `First vocal set at ${formatTime(vocalStart)}.`;
  previousLine.textContent = "";
  nextLine.textContent = "";
  statusPanel.textContent = "Now generate sync. The first lyric will start at that vocal marker.";
  drawWaveform(audioPlayer.currentTime || 0);
}

function markLastVocal() {
  if (!audioBuffer) return;

  setLastVocal(audioPlayer.currentTime || 0);
  clearGeneratedSync();
  activeLine.textContent = `Last vocal set at ${formatTime(vocalEnd)}.`;
  previousLine.textContent = "";
  nextLine.textContent = "";
  statusPanel.textContent = "Now generate sync. The lyrics will finish at that last vocal marker.";
  drawWaveform(audioPlayer.currentTime || 0);
}

function jumpToFirstVocal() {
  if (!audioBuffer) return;

  audioPlayer.currentTime = vocalStart;
  renderPlaybackState();
}

function jumpToLastVocal() {
  if (!audioBuffer) return;

  audioPlayer.currentTime = getEffectiveVocalEnd();
  renderPlaybackState();
}

function nudgeFirstVocal(amount) {
  if (!audioBuffer) return;

  setFirstVocal(vocalStart + amount);
  audioPlayer.currentTime = vocalStart;
  clearGeneratedSync();
  activeLine.textContent = `First vocal set at ${formatTime(vocalStart)}.`;
  statusPanel.textContent = "Marker adjusted. Generate sync again to use the new first vocal time.";
  renderPlaybackState();
}

function updateVocalStartFromInput() {
  if (!audioBuffer) return;

  setFirstVocal(Number(vocalStartInput.value || 0));
  clearGeneratedSync();
  statusPanel.textContent = `First vocal set at ${formatTime(vocalStart)}. Generate sync to apply it.`;
  drawWaveform(audioPlayer.currentTime || 0);
}

function updateVocalEndFromInput() {
  if (!audioBuffer) return;

  setLastVocal(Number(vocalEndInput.value || 0));
  clearGeneratedSync();
  statusPanel.textContent = `Last vocal set at ${formatTime(vocalEnd)}. Generate sync to apply it.`;
  drawWaveform(audioPlayer.currentTime || 0);
}

function setFirstVocal(time) {
  vocalStart = clamp(time, 0, Math.max(0, audioBuffer.duration - 0.5));
  if (vocalEnd && vocalEnd <= vocalStart + 0.5) {
    vocalEnd = clamp(vocalStart + 0.5, 0, audioBuffer.duration);
    vocalEndInput.value = roundTime(vocalEnd).toString();
  }
  vocalStartInput.value = roundTime(vocalStart).toString();
}

function setLastVocal(time) {
  vocalEnd = clamp(time, Math.min(audioBuffer.duration, vocalStart + 0.5), audioBuffer.duration);
  vocalEndInput.value = roundTime(vocalEnd).toString();
}

function getEffectiveVocalEnd() {
  if (!audioBuffer) return 0;
  if (vocalEnd > vocalStart + 0.5) return vocalEnd;
  return Math.max(vocalStart + 1, audioBuffer.duration - Math.min(3, audioBuffer.duration * 0.04));
}

function clearGeneratedSync() {
  lyricMap = [];
  timelineList.innerHTML = "";
  exportJson.disabled = true;
  exportLrc.disabled = true;
  updateSaveStatus(null);
  if (!tapMode) {
    tapStarts = [];
    updateTapControls();
  }
}

function startTapSync() {
  const lines = parseLyrics();
  if (!audioBuffer || !lines.length) return;

  tapMode = true;
  tapStarts = getSavedDraft()?.tapStarts || [];
  clearGeneratedSync();
  renderTapPreview(lines);
  if (tapStarts.length) {
    saveDraftProgress();
  }
  audioPlayer.currentTime = tapStarts[tapStarts.length - 1] || vocalStart || 0;
  audioPlayer.play();
  statusPanel.textContent = "Tap when each displayed line should begin.";
  updateTapControls();
}

function tapNextLine() {
  const lines = parseLyrics();
  if (!tapMode || !lines.length || tapStarts.length >= lines.length) return;

  const time = audioPlayer.currentTime || 0;
  tapStarts.push(roundTime(time));
  renderTapPreview(lines);
  statusPanel.textContent = `${tapStarts.length} of ${lines.length} lines tapped.`;

  if (tapStarts.length >= lines.length) {
    statusPanel.textContent = "All lines tapped. Press Finish to save this sync.";
  }
  saveDraftProgress();
  updateTapControls();
}

function undoTap() {
  const lines = parseLyrics();
  if (!tapMode || !tapStarts.length) return;

  tapStarts.pop();
  renderTapPreview(lines);
  saveDraftProgress();
  statusPanel.textContent = "Last tap removed. Progress saved.";
  updateTapControls();
}

function finishTapSync() {
  const lines = parseLyrics();
  if (!lines.length) return;

  if (!tapStarts.length) {
    statusPanel.textContent = "Tap the first lyric line before finishing.";
    return;
  }

  const endTime = getTapEndTime();
  const starts = tapStarts.slice();
  if (starts.length < lines.length) {
    const remaining = lines.length - starts.length;
    const base = starts[starts.length - 1] ?? (vocalStart || audioPlayer.currentTime || 0);
    const gap = Math.max(0.8, (endTime - base) / Math.max(1, remaining + 1));
    for (let index = starts.length; index < lines.length; index += 1) {
      starts.push(roundTime(Math.min(endTime - 0.2, base + gap * (index - tapStarts.length + 1))));
    }
  }

  lyricMap = lines.map((line, index) => ({
    index,
    line,
    start: roundTime(starts[index]),
    end: roundTime(index < lines.length - 1 ? starts[index + 1] : Math.max(starts[index] + 0.6, endTime)),
  }));

  tapMode = false;
  const savedAt = saveCurrentSync();
  if (!savedAt) {
    updateSaveStatus(null);
    showSaveBanner("Could not save. Try JSON or LRC download.", false);
    statusPanel.textContent = "The browser did not save this sync. Use JSON or LRC to download it.";
    updateTapControls();
    return;
  }

  renderTimeline();
  renderPlaybackState();
  exportJson.disabled = false;
  exportLrc.disabled = false;
  updateSaveStatus(savedAt);
  showSaveBanner(`Saved in this browser at ${formatClockTime(savedAt)}`, true);
  statusPanel.textContent = "Saved in this browser. Use JSON or LRC if you want a downloaded file.";
  updateTapControls();
}

function renderTapPreview(lines) {
  const index = Math.min(tapStarts.length, lines.length - 1);
  previousLine.textContent = lines[index - 1] || "";
  activeLine.textContent = lines[index] || "All lines tapped.";
  nextLine.textContent = lines[index + 1] || "";
  tapProgress.textContent = `${tapStarts.length} / ${lines.length} lines tapped`;
  renderTapTimeline(lines);
}

function renderTapTimeline(lines) {
  timelineList.innerHTML = "";
  lines.forEach((line, index) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `timeline-row ${index === tapStarts.length ? "active" : ""}`;
    row.innerHTML = `<span class="timeline-time">${tapStarts[index] === undefined ? "--:--" : formatTime(tapStarts[index])}</span><span>${escapeHtml(line)}</span>`;
    timelineList.appendChild(row);
  });
}

function updateTapControls() {
  const lines = parseLyrics();
  tapProgress.textContent = `${tapStarts.length} / ${lines.length} lines tapped`;
  tapLineButton.disabled = !tapMode || tapStarts.length >= lines.length;
  undoTapButton.disabled = !tapMode || !tapStarts.length;
  finishTapButton.disabled = !tapMode;
  startTapButton.disabled = !(audioBuffer && lines.length);
  loadSavedButton.disabled = tapMode || !hasSavedSync();
}

function saveDraftProgress() {
  const key = getDraftKey();
  if (!key || !tapStarts.length) return null;

  const savedAt = new Date().toISOString();
  const payload = {
    savedAt,
    tapStarts,
    vocalStart,
    vocalEnd,
  };
  localStorage.setItem(key, JSON.stringify(payload));
  updateSaveStatus(savedAt, "draft");
  showSaveBanner(`Progress saved at ${formatClockTime(savedAt)}`, true);
  return savedAt;
}

function saveCurrentSync() {
  const key = getSaveKey();
  if (!key || !lyricMap.length) return null;

  const savedAt = new Date().toISOString();
  const payload = {
    savedAt,
    vocalStart,
    vocalEnd,
    lyricMap,
  };
  localStorage.setItem(key, JSON.stringify(payload));
  localStorage.removeItem(getDraftKey());
  return savedAt;
}

function loadSavedSync() {
  const saved = getSavedSync();
  if (saved) {
    tapMode = false;
    tapStarts = [];
    vocalStart = Number(saved.vocalStart || 0);
    vocalEnd = Number(saved.vocalEnd || 0);
    vocalStartInput.value = roundTime(vocalStart).toString();
    vocalEndInput.value = roundTime(vocalEnd).toString();
    lyricMap = saved.lyricMap;
    renderTimeline();
    renderPlaybackState();
    exportJson.disabled = false;
    exportLrc.disabled = false;
    updateSaveStatus(saved.savedAt, "final");
    statusPanel.textContent = "Saved sync loaded from this browser. Ready to play.";
    updateTapControls();
    return;
  }

  const draft = getSavedDraft();
  if (!draft) return;

  tapMode = true;
  tapStarts = draft.tapStarts || [];
  vocalStart = Number(draft.vocalStart || 0);
  vocalEnd = Number(draft.vocalEnd || 0);
  vocalStartInput.value = roundTime(vocalStart).toString();
  vocalEndInput.value = roundTime(vocalEnd).toString();
  renderTapPreview(parseLyrics());
  updateSaveStatus(draft.savedAt, "draft");
  statusPanel.textContent = "Saved tap progress loaded. Continue tapping or press Finish.";
  updateTapControls();
}

function updateSaveStatus(savedAt, type = "final") {
  if (!saveStatus) return;

  if (!savedAt) {
    saveStatus.textContent = "Not saved yet";
    saveStatus.classList.remove("is-saved", "is-draft");
    if (saveBanner) saveBanner.hidden = true;
    return;
  }

  const time = formatClockTime(savedAt);
  saveStatus.textContent = type === "draft" ? `Progress saved ${time}` : `Saved ${time}`;
  saveStatus.classList.toggle("is-draft", type === "draft");
  saveStatus.classList.toggle("is-saved", type !== "draft");
}

function showSaveBanner(message, isSuccess) {
  if (!saveBanner) return;

  saveBanner.textContent = message;
  saveBanner.hidden = false;
  saveBanner.classList.toggle("is-error", !isSuccess);
}

function formatClockTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function maybeRestoreSavedSync() {
  if (tapMode || lyricMap.length || !audioBuffer || !parseLyrics().length) return false;
  if (!hasSavedSync()) return false;

  loadSavedSync();
  return true;
}

function hasSavedSync() {
  return Boolean(getSavedSync() || getSavedDraft());
}

function getSavedSync() {
  const key = getSaveKey();
  if (!key) return null;

  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (!saved?.lyricMap?.length) return null;
    return saved;
  } catch {
    return null;
  }
}

function getSavedDraft() {
  const key = getDraftKey();
  if (!key) return null;

  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (!saved?.tapStarts?.length) return null;
    return saved;
  } catch {
    return null;
  }
}

function getSaveKey() {
  const lines = parseLyrics();
  if (!currentSongMeta || !audioBuffer || !lines.length) return "";
  const lyricHash = hashText(lines.join("\n"));
  const duration = Math.round(audioBuffer.duration * 10);
  return `lyricsync:${currentSongMeta.name}:${currentSongMeta.size}:${currentSongMeta.modified}:${duration}:${lyricHash}`;
}

function getDraftKey() {
  const key = getSaveKey();
  return key ? `${key}:draft` : "";
}

function hashText(text) {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function getTapEndTime() {
  if (!audioBuffer) return 0;
  if (vocalEnd > vocalStart + 0.5) return vocalEnd;
  return audioPlayer.duration || audioBuffer.duration;
}

function handleKeyboardTap(event) {
  if (!tapMode || event.code !== "Space") return;
  const target = event.target;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;

  event.preventDefault();
  tapNextLine();
}

function startWaveformScrub(event) {
  if (!audioBuffer) return;

  isScrubbingWaveform = true;
  waveform.setPointerCapture?.(event.pointerId);
  seekWaveform(event);
}

function scrubWaveform(event) {
  if (!isScrubbingWaveform || !audioBuffer) return;

  seekWaveform(event);
}

function stopWaveformScrub(event) {
  if (!isScrubbingWaveform) return;

  isScrubbingWaveform = false;
  waveform.releasePointerCapture?.(event.pointerId);
}

function seekWaveform(event) {
  const rect = waveform.getBoundingClientRect();
  const progress = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  audioPlayer.currentTime = progress * audioBuffer.duration;
  statusPanel.textContent = `Playhead at ${formatTime(audioPlayer.currentTime)}. Press Set first vocal when it matches the first sung line.`;
  renderPlaybackState();
}

function analyzeEnergy(buffer) {
  const channel = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const frameSize = Math.floor(sampleRate * 0.08);
  const frames = [];

  for (let start = 0; start < channel.length; start += frameSize) {
    let total = 0;
    let peak = 0;
    const end = Math.min(start + frameSize, channel.length);

    for (let i = start; i < end; i += 1) {
      const value = Math.abs(channel[i]);
      total += value * value;
      peak = Math.max(peak, value);
    }

    frames.push({
      time: start / sampleRate,
      rms: Math.sqrt(total / Math.max(1, end - start)),
      peak,
    });
  }

  return frames;
}

function findQuietSections(frames, duration) {
  if (!frames.length) return [];

  const sorted = frames.map((frame) => frame.rms).sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * 0.28)] * 1.35;
  const sections = [];
  let start = null;

  frames.forEach((frame, index) => {
    const isQuiet = frame.rms <= threshold;
    if (isQuiet && start === null) start = frame.time;
    if ((!isQuiet || index === frames.length - 1) && start !== null) {
      const end = isQuiet ? duration : frame.time;
      if (end - start >= 0.35) sections.push({ start, end });
      start = null;
    }
  });

  return sections;
}

function makeLineTimings(lines, duration, quietSections, mode, startAt, endAt) {
  const detectedIntro = firstLikelyVocalTime(quietSections, duration);
  const intro = startAt > 0 ? startAt : clamp(detectedIntro, 0, Math.min(8, duration * 0.12));
  const outro = Math.min(3, duration * 0.04);
  const usableStart = clamp(intro, 0, Math.max(0, duration - 1));
  const requestedEnd = endAt > usableStart + 0.5 ? endAt : duration - outro;
  const usableEnd = clamp(Math.max(usableStart + 1, requestedEnd), usableStart + 1, duration);
  const weights = lines.map((line) => lineWeight(line, mode));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const pauses = lines.map((line, index) => (index === lines.length - 1 ? 0 : pauseAfterLine(line, mode)));
  const totalPause = pauses.reduce((sum, pause) => sum + pause, 0);
  const singableDuration = Math.max(lines.length * 0.45, usableEnd - usableStart - totalPause);
  const timings = [];
  let cursor = usableStart;

  lines.forEach((line, index) => {
    const share = weights[index] / totalWeight;
    const lineDuration = singableDuration * share;
    const end = index === lines.length - 1 ? usableEnd : Math.min(usableEnd, cursor + lineDuration);

    timings.push({ start: cursor, end });
    cursor = Math.min(usableEnd, end + pauses[index]);
  });

  return normalizeTimings(timings, usableEnd);
}

function firstLikelyVocalTime(quietSections, duration) {
  const frontSilence = quietSections.find((section) => section.start < 0.6 && section.end > 1.5);
  if (frontSilence) return Math.min(frontSilence.end + 0.15, duration * 0.2);
  return Math.min(1, duration * 0.04);
}

function lineWeight(line, mode) {
  const tokens = tokenize(line);
  const chars = line.replace(/\s/g, "").length;
  const punctuation = /[.!?]$/.test(line) ? 0.7 : 0;
  const dramatic = mode === "expressive" ? punctuation + 0.55 : punctuation;
  return Math.max(1.4, tokens.length * 1.15 + chars * 0.045 + dramatic);
}

function pauseAfterLine(line, mode) {
  const base = mode === "performance" ? 0.05 : 0.14;
  if (/[.!?]$/.test(line)) return base + (mode === "expressive" ? 0.35 : 0.2);
  if (/[,;:]$/.test(line)) return base + 0.12;
  return base;
}

function normalizeTimings(timings, usableEnd) {
  return timings.map((timing, index) => {
    const next = timings[index + 1];
    return {
      start: timing.start,
      end: next ? Math.min(timing.end, next.start - 0.04) : usableEnd,
    };
  });
}

function tokenize(line) {
  return line.match(/\S+/g) || [];
}

function makeWaveformPeaks(buffer, width) {
  const channel = buffer.getChannelData(0);
  const blockSize = Math.floor(channel.length / width);
  const peaks = [];

  for (let i = 0; i < width; i += 1) {
    let peak = 0;
    const start = i * blockSize;
    const end = Math.min(start + blockSize, channel.length);

    for (let j = start; j < end; j += 1) {
      peak = Math.max(peak, Math.abs(channel[j]));
    }

    peaks.push(peak);
  }

  return peaks;
}

function drawWaveform(currentTime) {
  const context = waveform.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = waveform.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width * ratio));
  const height = Math.max(1, Math.floor(rect.height * ratio));
  waveform.width = width;
  waveform.height = height;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#0e1014";
  context.fillRect(0, 0, width, height);

  const center = height / 2;
  const step = width / Math.max(1, waveformPeaks.length);

  waveformPeaks.forEach((peak, index) => {
    const x = index * step;
    const barHeight = Math.max(2, peak * height * 0.86);
    const played = audioBuffer && index / waveformPeaks.length <= currentTime / audioBuffer.duration;
    context.fillStyle = played ? "#ffcf56" : "#44505c";
    context.fillRect(x, center - barHeight / 2, Math.max(1, step * 0.72), barHeight);
  });

  if (audioBuffer && lyricMap.length) {
    lyricMap.forEach((line) => {
      const x = (line.start / audioBuffer.duration) * width;
      context.fillStyle = "rgba(78, 215, 183, 0.74)";
      context.fillRect(x, 0, Math.max(2, ratio * 2), height);
    });
  }

  if (audioBuffer) {
    const startX = (vocalStart / audioBuffer.duration) * width;
    const endX = (getEffectiveVocalEnd() / audioBuffer.duration) * width;
    context.fillStyle = "rgba(78, 215, 183, 0.08)";
    context.fillRect(startX, 0, Math.max(0, endX - startX), height);

    const x = startX;
    context.fillStyle = "#ff6f91";
    context.fillRect(x, 0, Math.max(3, ratio * 3), height);
    context.fillStyle = "rgba(255, 111, 145, 0.18)";
    context.fillRect(x, 0, Math.max(8, ratio * 8), height);

    context.fillStyle = "#4ed7b7";
    context.fillRect(endX, 0, Math.max(3, ratio * 3), height);
    context.fillStyle = "rgba(78, 215, 183, 0.16)";
    context.fillRect(Math.max(0, endX - Math.max(8, ratio * 8)), 0, Math.max(8, ratio * 8), height);
  }
}

function tick() {
  renderPlaybackState();
  if (!audioPlayer.paused) {
    animationFrame = requestAnimationFrame(tick);
  }
}

function renderPlaybackState() {
  const time = audioPlayer.currentTime || 0;
  drawWaveform(time);

  if (!lyricMap.length) return;

  const activeIndex = lyricMap.findIndex((line) => time >= line.start && time < line.end);
  const index = activeIndex === -1 ? nearestUpcomingIndex(time) : activeIndex;
  const active = lyricMap[index];

  previousLine.textContent = lyricMap[index - 1]?.line || "";
  nextLine.textContent = lyricMap[index + 1]?.line || "";
  activeLine.textContent = active ? active.line : "Waiting for the first lyric...";

  [...timelineList.children].forEach((row, rowIndex) => {
    row.classList.toggle("active", rowIndex === index);
  });
}

function nearestUpcomingIndex(time) {
  const upcoming = lyricMap.findIndex((line) => time < line.start);
  if (upcoming !== -1) return upcoming;
  return lyricMap.length - 1;
}

function renderTimeline() {
  timelineList.innerHTML = "";
  lyricMap.forEach((line) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "timeline-row";
    row.innerHTML = `<span class="timeline-time">${formatTime(line.start)}</span><span>${escapeHtml(line.line)}</span>`;
    row.addEventListener("click", () => {
      audioPlayer.currentTime = line.start;
      renderPlaybackState();
    });
    timelineList.appendChild(row);
  });
}

function toLrc(lines) {
  return lines.map((line) => `[${formatLrcTime(line.start)}]${line.line}`).join("\n");
}

function downloadFile(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  return `${mins}:${String(secs).padStart(2, "0")}.${tenths}`;
}

function formatLrcTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const hundredths = Math.floor((seconds % 1) * 100);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function roundTime(value) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
