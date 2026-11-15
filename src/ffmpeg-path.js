// The ffmpeg binary: FFMPEG_PATH if set (e.g. a system ffmpeg when the ffmpeg-static download fails on a Linux build),
// otherwise the one from the ffmpeg-static npm package (has libass + harfbuzz + fribidi → correct Persian text).
import staticPath from "ffmpeg-static";

export const ffmpegPath = process.env.FFMPEG_PATH || staticPath;
